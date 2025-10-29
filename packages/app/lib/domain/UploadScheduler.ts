/**
 * 上传调度器 - 领域服务层
 * 管理上传任务调度、并发控制和优先级管理
 */

import { EventBusInterface } from '../infrastructure/EventBus'
import { TimerServiceInterface } from '../infrastructure/TimerService'
import { ChunkEntity } from '../data-access/entities'

export interface UploadTask {
  id: string
  chunkId: string
  sessionId: string
  priority: number
  retryCount: number
  maxRetries: number
  createdAt: number
  scheduledAt?: number
  startedAt?: number
  completedAt?: number
  status: TaskStatus
  error?: string
  estimatedTime: number
  actualTime?: number
}

export enum TaskStatus {
  PENDING = 'pending',
  SCHEDULED = 'scheduled',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
  PAUSED = 'paused'
}

export interface SchedulerConfig {
  maxConcurrency: number
  retryDelay: number
  maxRetries: number
  priorityLevels: number
  enableAdaptiveConcurrency: boolean
  enableLoadBalancing: boolean
  taskTimeout: number
  healthCheckInterval: number
}

export interface ScheduleStatus {
  totalTasks: number
  pendingTasks: number
  runningTasks: number
  completedTasks: number
  failedTasks: number
  currentConcurrency: number
  maxConcurrency: number
  averageTaskTime: number
  throughput: number
  errorRate: number
}

export interface TaskExecutor {
  execute(task: UploadTask): Promise<void>
  canExecute(task: UploadTask): boolean
  getEstimatedTime(task: UploadTask): number
}

export interface UploadSchedulerInterface {
  // 调度上传任务
  scheduleUpload(chunks: ChunkEntity[]): void
  // 添加单个任务
  addTask(chunk: ChunkEntity, priority?: number): string
  // 设置并发数
  setConcurrency(concurrency: number): void
  // 设置任务优先级
  setPriority(taskId: string, priority: number): void
  // 设置执行器（用于延迟注入/替换执行器）
  setExecutor(executor: TaskExecutor): void
  // 暂停调度器
  pause(): void
  // 恢复调度器
  resume(): void
  // 取消任务
  cancelTask(taskId: string): void
  // 取消会话的所有任务
  cancelSession(sessionId: string): void
  // 获取调度状态
  getScheduleStatus(): ScheduleStatus
  // 获取任务信息
  getTask(taskId: string): UploadTask | undefined
  // 获取会话任务
  getSessionTasks(sessionId: string): UploadTask[]
  // 判断是否存在指定会话+分片的任务（用于执行器 canExecute）
  hasTask(sessionId: string, chunkId: string): boolean
}

export class UploadScheduler implements UploadSchedulerInterface {
  private tasks: Map<string, UploadTask> = new Map()
  private taskQueue: UploadTask[] = []
  private runningTasks: Map<string, UploadTask> = new Map()
  private completedTasks: Map<string, UploadTask> = new Map()
  private executor: TaskExecutor
  private eventBus: EventBusInterface
  private timerService: TimerServiceInterface
  private config: SchedulerConfig
  private isPaused: boolean = false
  private isRunning: boolean = false
  private schedulerTimer?: string
  private healthCheckTimer?: string
  private statistics = {
    totalExecuted: 0,
    totalExecutionTime: 0,
    totalErrors: 0,
    lastThroughputCheck: Date.now(),
    tasksInLastMinute: 0
  }

  constructor(
    executor: TaskExecutor,
    eventBus: EventBusInterface,
    timerService: TimerServiceInterface,
    config?: Partial<SchedulerConfig>
  ) {
    this.executor = executor
    this.eventBus = eventBus
    this.timerService = timerService
    this.config = {
      maxConcurrency: 3,
      retryDelay: 1000,
      maxRetries: 3,
      priorityLevels: 10,
      enableAdaptiveConcurrency: true,
      enableLoadBalancing: true,
      taskTimeout: 30000,
      healthCheckInterval: 5000,
      ...config
    }

    this.startScheduler()
    this.startHealthCheck()
  }

  setExecutor(executor: TaskExecutor): void {
    this.executor = executor
  }

  scheduleUpload(chunks: ChunkEntity[]): void {
    const tasks = chunks.map(chunk => this.createTask(chunk))
    
    // 按优先级排序
    tasks.sort((a, b) => b.priority - a.priority)
    
    tasks.forEach(task => {
      this.tasks.set(task.id, task)
      this.taskQueue.push(task)
    })

    this.eventBus.emit('scheduler:upload:scheduled', {
      taskCount: tasks.length,
      sessionIds: [...new Set(chunks.map(c => c.sessionId))]
    })

    // 立即尝试执行任务
    this.processQueue()
  }

  addTask(chunk: ChunkEntity, priority: number = 5): string {
    const task = this.createTask(chunk, priority)
    
    this.tasks.set(task.id, task)
    
    // 按优先级插入队列
    this.insertTaskByPriority(task)

    this.eventBus.emit('scheduler:task:added', {
      taskId: task.id,
      chunkId: chunk.id,
      priority: task.priority
    })

    // 尝试立即执行
    this.processQueue()
    
    return task.id
  }

  setConcurrency(concurrency: number): void {
    if (concurrency < 1) {
      throw new Error('Concurrency must be at least 1')
    }

    const oldConcurrency = this.config.maxConcurrency
    this.config.maxConcurrency = concurrency

    this.eventBus.emit('scheduler:concurrency:changed', {
      oldConcurrency,
      newConcurrency: concurrency
    })

    // 如果增加了并发数，尝试执行更多任务
    if (concurrency > oldConcurrency) {
      this.processQueue()
    }
  }

  setPriority(taskId: string, priority: number): void {
    const task = this.tasks.get(taskId)
    if (!task) {
      throw new Error(`Task ${taskId} not found`)
    }

    if (task.status === TaskStatus.RUNNING || task.status === TaskStatus.COMPLETED) {
      throw new Error(`Cannot change priority of ${task.status} task`)
    }

    const oldPriority = task.priority
    task.priority = Math.max(0, Math.min(priority, this.config.priorityLevels - 1))

    // 如果任务在队列中，重新排序
    if (task.status === TaskStatus.PENDING) {
      this.removeFromQueue(taskId)
      this.insertTaskByPriority(task)
    }

    this.eventBus.emit('scheduler:priority:changed', {
      taskId,
      oldPriority,
      newPriority: task.priority
    })
  }

  pause(): void {
    this.isPaused = true
    
    this.eventBus.emit('scheduler:paused', {
      runningTasks: this.runningTasks.size,
      pendingTasks: this.taskQueue.length
    })
  }

  resume(): void {
    this.isPaused = false
    
    this.eventBus.emit('scheduler:resumed', {
      pendingTasks: this.taskQueue.length
    })

    // 恢复后立即处理队列
    this.processQueue()
  }

  cancelTask(taskId: string): void {
    const task = this.tasks.get(taskId)
    if (!task) {
      return
    }

    if (task.status === TaskStatus.RUNNING) {
      // 如果任务正在运行，标记为取消，等待执行器处理
      task.status = TaskStatus.CANCELLED
      this.runningTasks.delete(taskId)
    } else if (task.status === TaskStatus.PENDING || task.status === TaskStatus.SCHEDULED) {
      // 如果任务还在队列中，直接移除
      task.status = TaskStatus.CANCELLED
      this.removeFromQueue(taskId)
    }

    this.eventBus.emit('scheduler:task:cancelled', {
      taskId,
      chunkId: task.chunkId
    })
  }

  cancelSession(sessionId: string): void {
    const sessionTasks = Array.from(this.tasks.values())
      .filter(task => task.sessionId === sessionId)

    sessionTasks.forEach(task => {
      this.cancelTask(task.id)
    })

    this.eventBus.emit('scheduler:session:cancelled', {
      sessionId,
      cancelledCount: sessionTasks.length
    })
  }

  getScheduleStatus(): ScheduleStatus {
    const allTasks = Array.from(this.tasks.values())
    const totalTasks = allTasks.length
    const pendingTasks = allTasks.filter(t => t.status === TaskStatus.PENDING).length
    const runningTasks = this.runningTasks.size
    const completedTasks = allTasks.filter(t => t.status === TaskStatus.COMPLETED).length
    const failedTasks = allTasks.filter(t => t.status === TaskStatus.FAILED).length

    const averageTaskTime = this.statistics.totalExecuted > 0
      ? this.statistics.totalExecutionTime / this.statistics.totalExecuted
      : 0

    const throughput = this.calculateThroughput()
    const errorRate = this.statistics.totalExecuted > 0
      ? (this.statistics.totalErrors / this.statistics.totalExecuted) * 100
      : 0

    return {
      totalTasks,
      pendingTasks,
      runningTasks,
      completedTasks,
      failedTasks,
      currentConcurrency: runningTasks,
      maxConcurrency: this.config.maxConcurrency,
      averageTaskTime,
      throughput,
      errorRate
    }
  }

  getTask(taskId: string): UploadTask | undefined {
    return this.tasks.get(taskId)
  }

  getSessionTasks(sessionId: string): UploadTask[] {
    return Array.from(this.tasks.values())
      .filter(task => task.sessionId === sessionId)
  }

  hasTask(sessionId: string, chunkId: string): boolean {
    for (const task of this.tasks.values()) {
      if (
        task.sessionId === sessionId &&
        task.chunkId === chunkId &&
        task.status !== TaskStatus.CANCELLED &&
        task.status !== TaskStatus.COMPLETED &&
        task.status !== TaskStatus.FAILED
      ) {
        return true
      }
    }
    return false
  }

  // 获取推荐的并发数
  getRecommendedConcurrency(): number {
    if (!this.config.enableAdaptiveConcurrency) {
      return this.config.maxConcurrency
    }

    const status = this.getScheduleStatus()
    const { errorRate, averageTaskTime, throughput } = status

    // 基于错误率调整
    if (errorRate > 20) {
      return Math.max(1, Math.floor(this.config.maxConcurrency * 0.5))
    } else if (errorRate > 10) {
      return Math.max(1, Math.floor(this.config.maxConcurrency * 0.7))
    }

    // 基于吞吐量调整
    if (throughput > 0 && averageTaskTime < 5000) { // 任务执行时间小于5秒
      return Math.min(this.config.maxConcurrency + 1, 10)
    }

    return this.config.maxConcurrency
  }

  // 清理已完成的任务
  cleanup(): void {
    const cutoffTime = Date.now() - (24 * 60 * 60 * 1000) // 24小时前
    
    let cleanedCount = 0
    this.tasks.forEach((task, taskId) => {
      if (task.status === TaskStatus.COMPLETED && 
          task.completedAt && 
          task.completedAt < cutoffTime) {
        this.tasks.delete(taskId)
        this.completedTasks.delete(taskId)
        cleanedCount++
      }
    })

    if (cleanedCount > 0) {
      this.eventBus.emit('scheduler:cleanup:completed', {
        cleanedCount,
        remainingTasks: this.tasks.size
      })
    }
  }

  private createTask(chunk: ChunkEntity, priority?: number): UploadTask {
    const taskId = this.generateTaskId()
    const estimatedTime = this.executor.getEstimatedTime({ 
      id: taskId, 
      chunkId: chunk.id,
      sessionId: chunk.sessionId,
      priority: priority || this.calculateChunkPriority(chunk),
      retryCount: 0,
      maxRetries: this.config.maxRetries,
      createdAt: Date.now(),
      status: TaskStatus.PENDING,
      estimatedTime: 0
    })

    return {
      id: taskId,
      chunkId: chunk.id,
      sessionId: chunk.sessionId,
      priority: priority || this.calculateChunkPriority(chunk),
      retryCount: 0,
      maxRetries: this.config.maxRetries,
      createdAt: Date.now(),
      status: TaskStatus.PENDING,
      estimatedTime
    }
  }

  private calculateChunkPriority(chunk: ChunkEntity): number {
    let priority = 5 // 默认优先级

    // 基于分片索引的优先级
    if (chunk.index === 0) {
      priority += 3 // 第一个分片优先级最高
    } else if (chunk.index < 5) {
      priority += 2 // 前几个分片优先级较高
    }

    // 基于重试次数的优先级调整
    priority -= chunk.retryCount

    // 基于分片大小的优先级调整
    if (chunk.size < 1024 * 1024) { // 小于1MB的分片优先级较高
      priority += 1
    }

    return Math.max(0, Math.min(priority, this.config.priorityLevels - 1))
  }

  private insertTaskByPriority(task: UploadTask): void {
    let insertIndex = 0
    
    // 找到合适的插入位置
    for (let i = 0; i < this.taskQueue.length; i++) {
      if (this.taskQueue[i].priority < task.priority) {
        insertIndex = i
        break
      }
      insertIndex = i + 1
    }

    this.taskQueue.splice(insertIndex, 0, task)
  }

  private removeFromQueue(taskId: string): void {
    const index = this.taskQueue.findIndex(task => task.id === taskId)
    if (index > -1) {
      this.taskQueue.splice(index, 1)
    }
  }

  private async processQueue(): Promise<void> {
    if (this.isPaused || this.runningTasks.size >= this.config.maxConcurrency) {
      return
    }

    while (this.taskQueue.length > 0 && 
           this.runningTasks.size < this.config.maxConcurrency && 
           !this.isPaused) {
      
      const task = this.taskQueue.shift()!
      
      if (task.status === TaskStatus.CANCELLED) {
        continue
      }

      if (!this.executor.canExecute(task)) {
        // 如果执行器不能执行此任务，重新放回队列末尾
        this.taskQueue.push(task)
        break
      }

      await this.executeTask(task)
    }
  }

  private async executeTask(task: UploadTask): Promise<void> {
    task.status = TaskStatus.RUNNING
    task.startedAt = Date.now()
    this.runningTasks.set(task.id, task)

    this.eventBus.emit('scheduler:task:started', {
      taskId: task.id,
      chunkId: task.chunkId,
      sessionId: task.sessionId
    })

    try {
      // 设置任务超时
      const timeoutPromise = new Promise<never>((_, reject) => {
        this.timerService.setTimeout(() => {
          reject(new Error('Task timeout'))
        }, this.config.taskTimeout)
      })

      // 执行任务
      await Promise.race([
        this.executor.execute(task),
        timeoutPromise
      ])

      // 任务成功完成
      task.status = TaskStatus.COMPLETED
      task.completedAt = Date.now()
      task.actualTime = task.completedAt - task.startedAt!

      this.runningTasks.delete(task.id)
      this.completedTasks.set(task.id, task)

      // 更新统计信息
      this.statistics.totalExecuted++
      this.statistics.totalExecutionTime += task.actualTime
      this.statistics.tasksInLastMinute++

      this.eventBus.emit('scheduler:task:completed', {
        taskId: task.id,
        chunkId: task.chunkId,
        sessionId: task.sessionId,
        executionTime: task.actualTime
      })

    } catch (error) {
      // 任务执行失败
      task.error = error instanceof Error ? error.message : String(error)
      task.retryCount++

      this.runningTasks.delete(task.id)
      this.statistics.totalErrors++

      if (task.retryCount < task.maxRetries) {
        // 重试任务
        task.status = TaskStatus.PENDING
        
        // 延迟后重新加入队列
        this.timerService.setTimeout(() => {
          if (task.status === TaskStatus.PENDING) {
            this.insertTaskByPriority(task)
            this.processQueue()
          }
        }, this.config.retryDelay * Math.pow(2, task.retryCount - 1)) // 指数退避

        this.eventBus.emit('scheduler:task:retry', {
          taskId: task.id,
          chunkId: task.chunkId,
          retryCount: task.retryCount,
          error: task.error
        })
      } else {
        // 重试次数用完，标记为失败
        task.status = TaskStatus.FAILED

        this.eventBus.emit('scheduler:task:failed', {
          taskId: task.id,
          chunkId: task.chunkId,
          sessionId: task.sessionId,
          error: task.error,
          retryCount: task.retryCount
        })
      }
    }

    // 继续处理队列
    this.processQueue()
  }

  private startScheduler(): void {
    if (this.isRunning) return

    this.isRunning = true
    this.schedulerTimer = this.timerService.setInterval(() => {
      if (!this.isPaused) {
        this.processQueue()
      }
    }, 100) // 每100ms检查一次队列
  }

  private startHealthCheck(): void {
    this.healthCheckTimer = this.timerService.setInterval(() => {
      this.performHealthCheck()
    }, this.config.healthCheckInterval)
  }

  private performHealthCheck(): void {
    // 自适应并发控制
    if (this.config.enableAdaptiveConcurrency) {
      const recommendedConcurrency = this.getRecommendedConcurrency()
      if (recommendedConcurrency !== this.config.maxConcurrency) {
        this.setConcurrency(recommendedConcurrency)
      }
    }

    // 清理过期任务
    this.cleanup()

    // 重置吞吐量统计
    this.statistics.tasksInLastMinute = 0
    this.statistics.lastThroughputCheck = Date.now()
  }

  private calculateThroughput(): number {
    const now = Date.now()
    const timeDiff = now - this.statistics.lastThroughputCheck
    
    if (timeDiff >= 60000) { // 1分钟
      const throughput = (this.statistics.tasksInLastMinute / timeDiff) * 60000 // 每分钟任务数
      return throughput
    }

    return 0
  }

  private generateTaskId(): string {
    return `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  // 清理资源
  dispose(): void {
    this.isPaused = true
    this.isRunning = false

    if (this.schedulerTimer) {
      this.timerService.clearTimer(this.schedulerTimer)
    }

    if (this.healthCheckTimer) {
      this.timerService.clearTimer(this.healthCheckTimer)
    }

    // 取消所有运行中的任务
    this.runningTasks.forEach(task => {
      task.status = TaskStatus.CANCELLED
    })

    this.tasks.clear()
    this.taskQueue = []
    this.runningTasks.clear()
    this.completedTasks.clear()
  }
}

/**
 * 上传调度器工厂
 */
export class UploadSchedulerFactory {
  static create(
    executor: TaskExecutor,
    eventBus: EventBusInterface,
    timerService: TimerServiceInterface,
    config?: Partial<SchedulerConfig>
  ): UploadScheduler {
    return new UploadScheduler(executor, eventBus, timerService, config)
  }

  static createHighThroughput(
    executor: TaskExecutor,
    eventBus: EventBusInterface,
    timerService: TimerServiceInterface
  ): UploadScheduler {
    return new UploadScheduler(executor, eventBus, timerService, {
      maxConcurrency: 6,
      enableAdaptiveConcurrency: true,
      enableLoadBalancing: true
    })
  }

  static createConservative(
    executor: TaskExecutor,
    eventBus: EventBusInterface,
    timerService: TimerServiceInterface
  ): UploadScheduler {
    return new UploadScheduler(executor, eventBus, timerService, {
      maxConcurrency: 2,
      enableAdaptiveConcurrency: false,
      retryDelay: 2000,
      maxRetries: 5
    })
  }
}