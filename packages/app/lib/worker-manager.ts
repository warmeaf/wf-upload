/**
 * Worker管理器
 * 在主线程中管理Hash计算Worker，处理消息通信
 * 支持多线程和单线程两种模式
 */

import type {
  WorkerStartMessage,
  WorkerMessage,
  EventEmitter,
  ChunkHashedEvent,
  AllChunksHashedEvent,
  FileHashedEvent,
  QueueAbortedEvent,
  ChunkInfo,
} from './types'
import { WorkerPool } from './worker-pool'
import { TaskQueue } from './task-queue'
import { ResultBuffer } from './result-buffer'

export class WorkerManager implements EventEmitter {
  // ============ 私有属性 ============

  private workerPool: WorkerPool | null = null // Worker线程池（多线程模式）
  private worker: Worker | null = null // 单Worker（单线程模式）
  private taskQueue: TaskQueue | null = null // 任务队列（多线程模式）
  private resultBuffer: ResultBuffer | null = null // 结果缓冲区（多线程模式）
  private enableMultiThreading: boolean = true // 是否启用多线程（默认true）
  private listeners: Map<string, Set<Function>> = new Map()

  // ============ 构造函数 ============

  constructor(enableMultiThreading: boolean = true) {
    this.enableMultiThreading = enableMultiThreading
  }

  // ============ 公共方法 ============

  async startHashing(file: File, chunkSize: number): Promise<void> {
    // 清理之前的资源
    this.terminate()

    // 创建分片
    const chunks = this.createChunks(file, chunkSize)

    // 根据配置选择处理模式
    if (this.enableMultiThreading) {
      await this.startMultiThreading(chunks)
    } else {
      await this.startSingleThreading(file, chunkSize)
    }
  }

  terminate(): void {
    // 多线程模式：终止WorkerPool
    if (this.workerPool) {
      this.workerPool.terminate()
      this.workerPool = null
    }

    // 单线程模式：终止单个Worker
    if (this.worker) {
      this.worker.terminate()
      this.worker = null
    }

    // 清理相关资源
    this.taskQueue = null
    this.resultBuffer = null
  }

  // ============ Worker管理 ============

  /**
   * 获取最优Worker数量
   */
  private getOptimalWorkerCount(): number {
    // 如果禁用多线程，返回1（单Worker模式）
    if (!this.enableMultiThreading) {
      return 1
    }

    // 优先使用系统硬件并发数
    const hardwareConcurrency =
      typeof navigator !== 'undefined' && navigator.hardwareConcurrency
        ? navigator.hardwareConcurrency
        : 4

    // 限制最大线程数，避免过度消耗资源
    const MAX_WORKERS = 8
    const MIN_WORKERS = 1

    return Math.max(MIN_WORKERS, Math.min(MAX_WORKERS, hardwareConcurrency))
  }

  /**
   * 创建分片
   */
  private createChunks(file: File, chunkSize: number): ChunkInfo[] {
    const chunks: ChunkInfo[] = []
    let start = 0
    let index = 0

    while (start < file.size) {
      const end = Math.min(start + chunkSize, file.size)
      const blob = file.slice(start, end)

      chunks.push({
        index,
        start,
        end,
        size: end - start,
        blob,
      })

      start = end
      index++
    }

    return chunks
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
   * 多线程模式：启动并行计算
   */
  private async startMultiThreading(chunks: ChunkInfo[]): Promise<void> {
    // 1. 初始化WorkerPool（根据系统决定线程数）
    const workerCount = this.getOptimalWorkerCount()
    this.workerPool = new WorkerPool(workerCount, this)

    // 2. 初始化任务队列和结果缓冲区
    this.taskQueue = new TaskQueue(chunks)
    this.resultBuffer = new ResultBuffer(chunks.length, this)

    // 3. 启动Worker处理任务
    this.workerPool.start(this.taskQueue, this.resultBuffer)

    // 4. 等待所有任务完成
    await this.workerPool.waitForCompletion()
  }

  /**
   * 单线程模式：回退到现有实现
   */
  private async startSingleThreading(
    file: File,
    chunkSize: number
  ): Promise<void> {
    return new Promise<void>((_resolve, reject) => {
      // 使用单个Worker，复用现有的hash-worker.ts逻辑
      this.worker = this.createWorker()

      this.worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
        this.handleWorkerMessage(e.data)
        // 注意：单线程模式下，完成是通过事件通知的，不需要resolve
      }

      this.worker.onerror = (error) => {
        const abortEvent: QueueAbortedEvent = {
          type: 'QueueAborted',
          error: new Error(`Worker error: ${error.message}`),
        }
        this.emit(abortEvent)
        reject(error)
      }

      // 发送开始消息（使用现有的WorkerStartMessage格式）
      const startMessage: WorkerStartMessage = {
        type: 'start',
        file,
        chunkSize,
      }
      this.worker.postMessage(startMessage)

      // 单线程模式下，等待FileHashed事件表示完成
      // 这里不需要resolve，因为完成是通过事件通知的
    })
  }

  private handleWorkerMessage(message: WorkerMessage): void {
    switch (message.type) {
      case 'chunkHashed':
        const chunkHashedEvent: ChunkHashedEvent = {
          type: 'ChunkHashed',
          chunk: message.chunk,
        }
        this.emit(chunkHashedEvent)
        break

      case 'allChunksHashed':
        const allChunksHashedEvent: AllChunksHashedEvent = {
          type: 'AllChunksHashed',
        }
        this.emit(allChunksHashedEvent)
        break

      case 'fileHashed':
        const fileHashedEvent: FileHashedEvent = {
          type: 'FileHashed',
          fileHash: message.fileHash,
        }
        this.emit(fileHashedEvent)
        break

      case 'error':
        const abortEvent: QueueAbortedEvent = {
          type: 'QueueAborted',
          error: new Error(message.error),
        }
        this.emit(abortEvent)
        break
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
