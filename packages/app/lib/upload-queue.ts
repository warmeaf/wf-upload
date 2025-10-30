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
  QueueAbortedEvent
} from './types';

export interface UploadQueueOptions {
  concurrency: number;
  onChunkCheck: (hash: string) => Promise<boolean>;
  onChunkUpload: (chunk: ChunkInfo & { hash: string }) => Promise<void>;
}

export class UploadQueue implements EventEmitter {
  private tasks: QueueTask[] = [];
  private stats: QueueStats = {
    totalChunks: 0,
    pending: 0,
    inFlight: 0,
    completed: 0,
    failed: 0,
    allChunksHashed: false
  };
  
  private listeners: Map<string, Set<Function>> = new Map();
  private options: UploadQueueOptions;
  private isAborted = false;

  constructor(options: UploadQueueOptions) {
    this.options = options;
  }

  /**
   * 添加分片任务到队列
   */
  addChunkTask(chunk: ChunkInfo & { hash: string }): void {
    if (this.isAborted) return;

    const task: QueueTask = {
      chunk,
      status: 'pending'
    };

    this.tasks.push(task);
    this.stats.totalChunks++;
    this.stats.pending++;

    // 立即尝试处理任务
    this.processQueue();
  }

  /**
   * 标记所有分片Hash已完成
   */
  markAllChunksHashed(): void {
    this.stats.allChunksHashed = true;
    this.checkQueueCompletion();
  }

  /**
   * 设置队列为完成状态（用于文件秒传场景）
   */
  markAsCompleted(): void {
    if (this.isAborted) return;

    // 将所有pending和inFlight任务标记为completed
    this.tasks.forEach(task => {
      if (task.status === 'pending' || task.status === 'inFlight') {
        task.status = 'completed';
      }
    });

    // 更新统计
    this.stats.completed = this.stats.totalChunks;
    this.stats.pending = 0;
    this.stats.inFlight = 0;
    this.stats.failed = 0;

    this.checkQueueCompletion();
  }

  /**
   * 处理队列任务
   */
  private async processQueue(): Promise<void> {
    if (this.isAborted) return;

    // 检查是否可以启动新任务
    const canStartNew = this.stats.inFlight < this.options.concurrency;
    if (!canStartNew) return;

    // 找到待处理的任务
    const pendingTask = this.tasks.find(task => task.status === 'pending');
    if (!pendingTask) return;

    // 开始处理任务
    pendingTask.status = 'inFlight';
    this.stats.pending--;
    this.stats.inFlight++;

    try {
      await this.processTask(pendingTask);
    } catch (error) {
      this.handleTaskError(pendingTask, error as Error);
    }

    // 继续处理队列
    this.processQueue();
  }

  /**
   * 处理单个任务
   */
  private async processTask(task: QueueTask): Promise<void> {
    try {
      // 1. 检查分片是否已存在（秒传）
      const exists = await this.options.onChunkCheck(task.chunk.hash);
      
      if (exists) {
        // 分片已存在，标记为成功
        this.completeTask(task);
      } else {
        // 2. 上传分片
        await this.options.onChunkUpload(task.chunk);
        this.completeTask(task);
      }
    } catch (error) {
      throw error;
    }
  }

  /**
   * 完成任务
   */
  private completeTask(task: QueueTask): void {
    task.status = 'completed';
    this.stats.inFlight--;
    this.stats.completed++;

    this.checkQueueCompletion();
  }

  /**
   * 处理任务错误
   */
  private handleTaskError(task: QueueTask, error: Error): void {
    task.status = 'failed';
    task.error = error;
    this.stats.inFlight--;
    this.stats.failed++;

    // 按照文档要求：任一分片失败立即中止队列
    this.abortQueue(error);
  }

  /**
   * 中止队列
   */
  private abortQueue(error: Error): void {
    this.isAborted = true;

    // 取消所有pending任务
    this.tasks.forEach(task => {
      if (task.status === 'pending') {
        task.status = 'failed';
        task.error = error;
      }
    });

    // 更新统计
    this.stats.pending = 0;
    // inFlight任务会自然完成或失败

    // 发送中止事件
    const abortEvent: QueueAbortedEvent = {
      type: 'QueueAborted',
      error
    };
    this.emit(abortEvent);
  }

  /**
   * 检查队列是否完成
   * 完成条件：
   * - allChunksHashed === true
   * - pending === 0
   * - inFlight === 0  
   * - failed === 0
   * - completed === totalChunks
   */
  private checkQueueCompletion(): void {
    if (this.isAborted) return;

    const isCompleted = 
      this.stats.allChunksHashed &&
      this.stats.pending === 0 &&
      this.stats.inFlight === 0 &&
      this.stats.failed === 0 &&
      this.stats.completed === this.stats.totalChunks;

    if (isCompleted) {
      const drainedEvent: QueueDrainedEvent = {
        type: 'QueueDrained'
      };
      this.emit(drainedEvent);
    }
  }

  /**
   * 获取队列统计信息
   */
  getStats(): QueueStats {
    return { ...this.stats };
  }

  /**
   * 获取失败的任务
   */
  getFailedTasks(): QueueTask[] {
    return this.tasks.filter(task => task.status === 'failed');
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