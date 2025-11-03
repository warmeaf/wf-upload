/**
 * Worker线程池
 * 管理多个Worker实例的生命周期，实现并行计算
 */

import type {
  WorkerTaskMessage,
  WorkerResultMessage,
  WorkerTaskErrorMessage,
  QueueAbortedEvent,
  EventEmitter,
} from './types'
import { TaskQueue } from './task-queue'
import { ResultBuffer } from './result-buffer'

export class WorkerPool {
  private workers: Worker[] = []
  private workerStates: Map<Worker, 'idle' | 'busy'> = new Map()
  private taskQueue: TaskQueue | null = null
  private resultBuffer: ResultBuffer | null = null
  private completionPromise: Promise<void> | null = null
  private completionResolve: (() => void) | null = null
  private completionReject: ((error: Error) => void) | null = null
  private isTerminated: boolean = false
  private activeTasks: number = 0
  private eventEmitter: EventEmitter

  constructor(workerCount: number, eventEmitter: EventEmitter) {
    this.eventEmitter = eventEmitter

    // 创建Worker实例
    for (let i = 0; i < workerCount; i++) {
      const worker = this.createWorker()
      this.workers.push(worker)
      this.workerStates.set(worker, 'idle')
      this.setupWorkerHandlers(worker)
    }
  }

  /**
   * 启动Worker处理任务
   */
  start(taskQueue: TaskQueue, resultBuffer: ResultBuffer): void {
    this.taskQueue = taskQueue
    this.resultBuffer = resultBuffer
    this.isTerminated = false
    this.activeTasks = 0

    // 创建完成Promise
    this.completionPromise = new Promise<void>((resolve, reject) => {
      this.completionResolve = resolve
      this.completionReject = reject
    })

    // 启动所有Worker开始处理任务
    this.workers.forEach((worker) => {
      this.assignNextTask(worker)
    })
  }

  /**
   * 等待所有任务完成
   */
  async waitForCompletion(): Promise<void> {
    if (this.completionPromise) {
      return this.completionPromise
    }
    return Promise.resolve()
  }

  /**
   * 终止所有Worker
   */
  terminate(): void {
    this.isTerminated = true

    // 终止所有Worker
    this.workers.forEach((worker) => {
      worker.terminate()
    })

    // 清理状态
    this.workers = []
    this.workerStates.clear()
    this.taskQueue = null
    this.resultBuffer = null

    // 如果还在等待完成，则reject
    if (this.completionReject) {
      this.completionReject(new Error('Worker pool terminated'))
    }
  }

  /**
   * 创建Worker实例
   */
  private createWorker(): Worker {
    return new Worker(new URL('./hash-worker.ts', import.meta.url), {
      type: 'module',
    })
  }

  /**
   * 设置Worker消息处理器
   */
  private setupWorkerHandlers(worker: Worker): void {
    worker.onmessage = (e: MessageEvent<WorkerResultMessage | WorkerTaskErrorMessage>) => {
      if (this.isTerminated) {
        return
      }

      const message = e.data

      if (message.type === 'result') {
        this.handleWorkerResult(worker, message)
      } else if (message.type === 'error') {
        this.handleWorkerError(message)
      }
    }

    worker.onerror = (error) => {
      if (this.isTerminated) {
        return
      }

      const abortEvent: QueueAbortedEvent = {
        type: 'QueueAborted',
        error: new Error(`Worker error: ${error.message}`),
      }
      this.eventEmitter.emit(abortEvent)
      this.terminate()
    }
  }

  /**
   * 分配下一个任务给Worker
   */
  private assignNextTask(worker: Worker): void {
    if (this.isTerminated || !this.taskQueue) {
      return
    }

    const task = this.taskQueue.dequeue()

    if (!task) {
      // 队列为空，Worker进入空闲状态
      this.workerStates.set(worker, 'idle')

      // 检查是否所有任务都完成
      this.checkCompletion()
      return
    }

    this.workerStates.set(worker, 'busy')
    this.activeTasks++

    // 发送任务给Worker
    const taskMessage: WorkerTaskMessage = {
      type: 'task',
      taskId: task.taskId,
      chunkIndex: task.chunk.index,
      blob: task.chunk.blob,
    }
    worker.postMessage(taskMessage)
  }

  /**
   * 处理Worker返回的结果
   */
  private handleWorkerResult(
    worker: Worker,
    message: WorkerResultMessage
  ): void {
    if (this.isTerminated || !this.resultBuffer || !this.taskQueue) {
      return
    }

    this.activeTasks--

    // 将结果传递给ResultBuffer
    const chunk = this.taskQueue.getChunkByIndex(message.chunkIndex)
    if (chunk) {
      this.resultBuffer.addResult(message.chunkIndex, message.hash, chunk)
    }

    // Worker完成任务，继续分配下一个任务
    this.assignNextTask(worker)
  }

  /**
   * 处理Worker错误
   */
  private handleWorkerError(
    message: WorkerTaskErrorMessage
  ): void {
    if (this.isTerminated) {
      return
    }

    this.activeTasks--

    // 触发错误事件
    const abortEvent: QueueAbortedEvent = {
      type: 'QueueAborted',
      error: new Error(`Worker task error:  ${message.error}`),
    }
    this.eventEmitter.emit(abortEvent)

    // 终止所有Worker
    this.terminate()
  }

  /**
   * 检查是否所有任务都完成
   */
  private checkCompletion(): void {
    if (this.isTerminated || !this.taskQueue) {
      return
    }

    // 检查条件：
    // 1. 任务队列为空
    // 2. 没有正在执行的任务
    // 3. 所有Worker都空闲
    const isQueueEmpty = this.taskQueue.length === 0
    const isNoActiveTasks = this.activeTasks === 0
    const areAllWorkersIdle = Array.from(this.workerStates.values()).every(
      (state) => state === 'idle'
    )

    if (isQueueEmpty && isNoActiveTasks && areAllWorkersIdle) {
      // 所有任务完成
      if (this.completionResolve) {
        this.completionResolve()
      }
    }
  }
}

