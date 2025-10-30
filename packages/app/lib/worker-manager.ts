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
  QueueAbortedEvent
} from './types';

export class WorkerManager implements EventEmitter {
  private worker: Worker | null = null;
  private listeners: Map<string, Set<Function>> = new Map();

  /**
   * 启动Hash计算
   */
  async startHashing(file: File, chunkSize: number): Promise<void> {
    if (this.worker) {
      this.worker.terminate();
    }

    try {
      // 创建Worker实例 - 使用TypeScript Worker文件，Vite会自动处理编译
      this.worker = new Worker(new URL('./hash-worker.ts', import.meta.url), { type: 'module' });

      // 监听Worker消息
      this.worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
        this.handleWorkerMessage(e.data);
      };

      this.worker.onerror = (error) => {
        const abortEvent: QueueAbortedEvent = {
          type: 'QueueAborted',
          error: new Error(`Worker error: ${error.message}`)
        };
        this.emit(abortEvent);
      };

      // 发送开始消息
      const startMessage: WorkerStartMessage = {
        type: 'start',
        file,
        chunkSize
      };
      this.worker.postMessage(startMessage);

    } catch (error) {
      // 如果Worker文件加载失败，回退到Blob方式
      console.warn('Failed to load worker file, falling back to blob worker:', error);
      await this.startHashingWithBlob(file, chunkSize);
    }
  }

  /**
   * 使用Blob方式启动Hash计算（回退方案）
   */
  private async startHashingWithBlob(file: File, chunkSize: number): Promise<void> {
    const workerBlob = await this.createWorkerBlob();
    const workerUrl = URL.createObjectURL(workerBlob);
    this.worker = new Worker(workerUrl);

    // 监听Worker消息
    this.worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
      this.handleWorkerMessage(e.data);
    };

    this.worker.onerror = (error) => {
      const abortEvent: QueueAbortedEvent = {
        type: 'QueueAborted',
        error: new Error(`Worker error: ${error.message}`)
      };
      this.emit(abortEvent);
    };

    // 发送开始消息
    const startMessage: WorkerStartMessage = {
      type: 'start',
      file,
      chunkSize
    };
    this.worker.postMessage(startMessage);

    // 清理URL
    URL.revokeObjectURL(workerUrl);
  }

  /**
   * 处理Worker消息
   */
  private handleWorkerMessage(message: WorkerMessage): void {
    switch (message.type) {
      case 'chunkHashed':
        const chunkHashedEvent: ChunkHashedEvent = {
          type: 'ChunkHashed',
          chunk: message.chunk
        };
        this.emit(chunkHashedEvent);
        break;

      case 'allChunksHashed':
        const allChunksHashedEvent: AllChunksHashedEvent = {
          type: 'AllChunksHashed'
        };
        this.emit(allChunksHashedEvent);
        break;

      case 'fileHashed':
        const fileHashedEvent: FileHashedEvent = {
          type: 'FileHashed',
          fileHash: message.fileHash
        };
        this.emit(fileHashedEvent);
        break;

      case 'error':
        const abortEvent: QueueAbortedEvent = {
          type: 'QueueAborted',
          error: new Error(message.error)
        };
        this.emit(abortEvent);
        break;
    }
  }

  /**
   * 创建Worker Blob（回退方案）
   * 当无法加载单独的Worker文件时使用
   */
  private async createWorkerBlob(): Promise<Blob> {
    // 这里我们内联Worker代码，实际项目中应该使用单独的文件
    const workerCode = `
      import SparkMD5 from 'spark-md5';

      function createChunks(file, chunkSize) {
        const chunks = [];
        let start = 0;
        let index = 0;

        while (start < file.size) {
          const end = Math.min(start + chunkSize, file.size);
          const blob = file.slice(start, end);
          
          chunks.push({
            index,
            start,
            end,
            size: end - start,
            blob
          });

          start = end;
          index++;
        }

        return chunks;
      }

      async function calculateChunkHash(blob) {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          
          reader.onload = (e) => {
            try {
              const arrayBuffer = e.target?.result;
              const hash = SparkMD5.ArrayBuffer.hash(arrayBuffer);
              resolve(hash.toLowerCase());
            } catch (error) {
              reject(error);
            }
          };
          
          reader.onerror = () => reject(new Error('Failed to read chunk'));
          reader.readAsArrayBuffer(blob);
        });
      }

      function calculateFileHash(chunkHashes) {
        const spark = new SparkMD5();
        
        for (const chunkHash of chunkHashes) {
          spark.append(chunkHash);
        }
        
        return spark.end().toLowerCase();
      }

      async function processFile(file, chunkSize) {
        try {
          const chunks = createChunks(file, chunkSize);
          const chunkHashes = [];

          for (const chunk of chunks) {
            const hash = await calculateChunkHash(chunk.blob);
            chunkHashes.push(hash);

            self.postMessage({
              type: 'chunkHashed',
              chunk: { ...chunk, hash }
            });
          }

          self.postMessage({
            type: 'allChunksHashed'
          });

          const fileHash = calculateFileHash(chunkHashes);
          self.postMessage({
            type: 'fileHashed',
            fileHash
          });

        } catch (error) {
          self.postMessage({
            type: 'error',
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }

      self.onmessage = (e) => {
        const { type, file, chunkSize } = e.data;
        
        if (type === 'start') {
          processFile(file, chunkSize);
        }
      };
    `;

    return new Blob([workerCode], { type: 'application/javascript' });
  }

  /**
   * 终止Worker
   */
  terminate(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }

  /**
   * 事件监听器实现
   */
  on<T extends any>(eventType: string, listener: (event: T) => void): void {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Set());
    }
    this.listeners.get(eventType)!.add(listener);
  }

  off<T extends any>(eventType: string, listener: (event: T) => void): void {
    const listeners = this.listeners.get(eventType);
    if (listeners) {
      listeners.delete(listener);
    }
  }

  emit<T extends any>(event: T & { type: string }): void {
    const listeners = this.listeners.get(event.type);
    if (listeners) {
      listeners.forEach(listener => listener(event));
    }
  }
}