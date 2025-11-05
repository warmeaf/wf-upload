/**
 * 并发上传队列
 * 严格按照文档要求管理分片上传任务，支持并发限制和状态跟踪
 */

import type {
  QueueTask,
  QueueStats,
  ChunkInfo,
  EventEmitter,
  QueueDrainedEvent,
  QueueAbortedEvent,
} from '../domain/types'

export interface UploadQueueOptions {
  concurrency: number
  onChunkCheck: (hash: string) => Promise<boolean>
  onChunkUpload: (chunk: ChunkInfo & { hash: string }) => Promise<void>
}

export class UploadQueue implements EventEmitter {
  // ============ 私有属性 ============

  private tasks: QueueTask[] = []
  private stats: QueueStats = {
    totalChunks: 0,
    pending: 0,
    inFlight: 0,
    completed: 0,
    failed: 0,
    allChunksHashed: false,
  }

  private listeners: Map<string, Set<Function>> = new Map()
  private options: UploadQueueOptions
  private isAborted = false

  // ============ 构造函数 ============

  constructor(options: UploadQueueOptions) {
    this.options = options
  }

  // ============ 公共方法 ============

  addChunkTask(chunk: ChunkInfo & { hash: string }): void {
    if (this.isAborted || this.isCompleted) return

    const task: QueueTask = {
      chunk,
      status: 'pending',
    }

    this.tasks.push(task)
    this.stats.totalChunks++
    this.stats.pending++

    // 立即尝试处理任务
    this.processQueue()
  }

  markAllChunksHashed(): void {
    this.stats.allChunksHashed = true
  }

  /**
   * 设置队列为完成状态（用于文件秒传场景）
   */
  markAsCompleted(): void {
    this.tasks.forEach((task) => {
      if (task.status === 'pending') {
        task.status = 'completed'
      }
    })

    this.stats.allChunksHashed = true
    this.stats.pending = 0
    this.stats.inFlight = 0
    this.stats.failed = 0
    this.stats.completed = this.stats.totalChunks

    this.checkQueueCompletion()
  }

  get isCompleted(): boolean {
    return (
      this.stats.allChunksHashed &&
      this.stats.pending === 0 &&
      this.stats.inFlight === 0 &&
      this.stats.failed === 0 &&
      this.stats.completed === this.stats.totalChunks
    )
  }

  getStats(): QueueStats {
    return { ...this.stats }
  }

  getFailedTasks(): QueueTask[] {
    return this.tasks.filter((task) => task.status === 'failed')
  }

  // ============ 队列处理 ============

  private async processQueue(): Promise<void> {
    if (this.isAborted || this.isCompleted) return

    // 检查是否可以启动新任务
    const canStartNew = this.stats.inFlight < this.options.concurrency
    if (!canStartNew) return

    // 找到待处理的任务
    const pendingTask = this.tasks.find((task) => task.status === 'pending')
    if (!pendingTask) return

    pendingTask.status = 'inFlight'
    this.stats.pending--
    this.stats.inFlight++

    try {
      await this.processTask(pendingTask)
    } catch (error) {
      this.handleTaskError(pendingTask, error as Error)
    }

    // 继续处理队列
    this.processQueue()
  }

  private async processTask(task: QueueTask): Promise<void> {
    if (this.isCompleted) {
      return
    }

    try {
      const exists = await this.options.onChunkCheck(task.chunk.hash)

      if (this.isCompleted) {
        return
      }

      if (exists) {
        this.completeTask(task)
      } else {
        await this.options.onChunkUpload(task.chunk)
        this.completeTask(task)
      }
    } catch (error) {
      this.handleTaskError(task, error as Error)
    }
  }

  private completeTask(task: QueueTask): void {
    task.status = 'completed'
    this.stats.inFlight--
    this.stats.completed++

    this.checkQueueCompletion()
  }

  private handleTaskError(task: QueueTask, error: Error): void {
    task.status = 'failed'
    task.error = error
    this.stats.inFlight--
    this.stats.failed++

    this.abortQueue(error)
  }

  private abortQueue(error: Error): void {
    this.isAborted = true

    const abortEvent: QueueAbortedEvent = {
      type: 'QueueAborted',
      error,
    }
    this.emit(abortEvent)
  }

  private checkQueueCompletion(): void {
    if (this.isCompleted) {
      const drainedEvent: QueueDrainedEvent = {
        type: 'QueueDrained',
      }
      this.emit(drainedEvent)
    }
  }

  // ============ 事件监听器实现 ============

  on<T extends any>(eventType: string, listener: (event: T) => void): void {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Set())
    }
    this.listeners.get(eventType)!.add(listener)
  }

  off<T extends any>(eventType: string, listener: (event: T) => void): void {
    const listeners = this.listeners.get(eventType)
    if (listeners) {
      listeners.delete(listener)
    }
  }

  emit<T extends any>(event: T & { type: string }): void {
    const listeners = this.listeners.get(event.type)
    if (listeners) {
      listeners.forEach((listener) => listener(event))
    }
  }
}

