/**
 * Worker管理器
 * 在主线程中管理Hash计算Worker，处理消息通信
 */

import type {
  WorkerStartMessage,
  WorkerMessage,
  EventEmitter,
  ChunkHashedEvent,
  AllChunksHashedEvent,
  FileHashedEvent,
  QueueAbortedEvent,
} from './types'

export class WorkerManager implements EventEmitter {
  private worker: Worker | null = null
  private listeners: Map<string, Set<Function>> = new Map()

  async startHashing(file: File, chunkSize: number): Promise<void> {
    this.worker && this.worker.terminate()

    this.worker = this.createWorker()

    this.worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
      this.handleWorkerMessage(e.data)
    }

    this.worker.onerror = (error) => {
      const abortEvent: QueueAbortedEvent = {
        type: 'QueueAborted',
        error: new Error(`Worker error: ${error.message}`),
      }
      this.emit(abortEvent)
    }

    // 发送开始消息
    const startMessage: WorkerStartMessage = {
      type: 'start',
      file,
      chunkSize,
    }
    this.worker.postMessage(startMessage)
  }

  private createWorker(): Worker {
    return new Worker(new URL('./hash-worker.ts', import.meta.url), {
      type: 'module',
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

  /**
   * 终止Worker
   */
  terminate(): void {
    if (this.worker) {
      this.worker.terminate()
      this.worker = null
    }
  }

  /**
   * 事件监听器实现
   */
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
