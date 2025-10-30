/**
 * 文件上传器
 * 协调整个上传流程，严格按照文档描述的流程逻辑执行
 */

import { WorkerManager } from './worker-manager';
import { UploadQueue } from './upload-queue';
import { ApiClient } from './api-client';
import SparkMD5 from 'spark-md5';

import type {
  FileInfo,
  UploadConfig,
  UploaderState,
  EventEmitter,
  ChunkHashedEvent,
  AllChunksHashedEvent,
  FileHashedEvent,
  QueueDrainedEvent,
  QueueAbortedEvent,
  ChunkInfo
} from './types';

export interface FileUploaderOptions {
  config: UploadConfig;
  onProgress?: (state: UploaderState) => void;
  onCompleted?: (downloadUrl: string) => void;
  onError?: (error: Error) => void;
}

export class FileUploader implements EventEmitter {
  private workerManager: WorkerManager;
  private uploadQueue: UploadQueue;
  private apiClient: ApiClient;
  private options: FileUploaderOptions;
  
  private state: UploaderState = {
    status: 'idle',
    progress: {
      chunksHashed: 0,
      chunksUploaded: 0,
      totalChunks: 0
    }
  };

  private listeners: Map<string, Set<Function>> = new Map();
  private chunkHashes: string[] = [];
  private isMerged = false;

  constructor(options: FileUploaderOptions) {
    this.options = options;
    this.apiClient = new ApiClient(options.config.baseUrl);
    this.workerManager = new WorkerManager();
    
    this.uploadQueue = new UploadQueue({
      concurrency: options.config.concurrency,
      onChunkCheck: this.handleChunkCheck.bind(this),
      onChunkUpload: this.handleChunkUpload.bind(this)
    });

    this.setupEventListeners();
  }

  /**
   * 开始上传文件
   */
  async upload(fileInfo: FileInfo): Promise<void> {
    try {
      this.resetState();
      this.state.status = 'uploading';
      this.state.progress.totalChunks = Math.ceil(fileInfo.size / this.options.config.chunkSize);
      this.notifyProgress();

      // 1. 创建上传会话
      await this.createSession(fileInfo);

      // 2. 启动Worker进行分片和Hash计算
      await this.workerManager.startHashing(fileInfo.file, this.options.config.chunkSize);

    } catch (error) {
      this.handleError(error as Error);
    }
  }

  /**
   * 创建上传会话
   */
  private async createSession(fileInfo: FileInfo): Promise<void> {
    const response = await this.apiClient.createSession({
      name: fileInfo.name,
      size: fileInfo.size,
      type: fileInfo.type,
      chunksLength: Math.ceil(fileInfo.size / this.options.config.chunkSize)
    });

    this.state.token = response.token;
  }

  /**
   * 设置事件监听器
   */
  private setupEventListeners(): void {
    // 监听Worker事件
    this.workerManager.on<ChunkHashedEvent>('ChunkHashed', this.handleChunkHashed.bind(this));
    this.workerManager.on<AllChunksHashedEvent>('AllChunksHashed', this.handleAllChunksHashed.bind(this));
    this.workerManager.on<FileHashedEvent>('FileHashed', this.handleFileHashed.bind(this));
    this.workerManager.on<QueueAbortedEvent>('QueueAborted', this.handleQueueAborted.bind(this));

    // 监听队列事件
    this.uploadQueue.on<QueueDrainedEvent>('QueueDrained', this.handleQueueDrained.bind(this));
    this.uploadQueue.on<QueueAbortedEvent>('QueueAborted', this.handleQueueAborted.bind(this));
  }

  /**
   * 处理分片Hash完成事件
   */
  private handleChunkHashed(event: ChunkHashedEvent): void {
    this.chunkHashes[event.chunk.index] = event.chunk.hash;
    this.state.progress.chunksHashed++;
    this.notifyProgress();

    // 将分片任务推入并发队列
    this.uploadQueue.addChunkTask(event.chunk);
  }

  /**
   * 处理所有分片Hash完成事件
   */
  private handleAllChunksHashed(_event: AllChunksHashedEvent): void {
    this.uploadQueue.markAllChunksHashed();
  }

  /**
   * 处理文件Hash完成事件
   */
  private async handleFileHashed(event: FileHashedEvent): Promise<void> {
    try {
      this.state.fileHash = event.fileHash;

      // 检查文件是否已存在（文件秒传）
      const checkResult = await this.apiClient.checkFile(this.state.token!, event.fileHash);
      
      if (checkResult.exists && checkResult.url) {
        // 文件已存在，执行秒传逻辑
        const queueStats = this.uploadQueue.getStats();
        
        if (queueStats.pending > 0 || queueStats.inFlight > 0) {
          // 队列中有任务在进行，设置队列为完成状态
          this.uploadQueue.markAsCompleted();
        }
        // 否则等待队列自然完成
        
        // 直接设置下载URL，等待QueueDrained事件
        this.state.downloadUrl = checkResult.url;
      }
      // 文件不存在，等待队列自然完成

    } catch (error) {
      this.handleError(error as Error);
    }
  }

  /**
   * 处理队列完成事件
   */
  private async handleQueueDrained(_event: QueueDrainedEvent): Promise<void> {
    try {
      if (this.isMerged) {
        // 已经合并过了，直接完成
        this.handleUploadCompleted();
        return;
      }

      // 检查是否需要计算文件Hash
      let fileHash = this.state.fileHash;
      if (!fileHash) {
        // 增量计算文件Hash
        fileHash = this.calculateFileHashFromChunks();
        this.state.fileHash = fileHash;
      }

      // 合并文件
      const downloadUrl = await this.apiClient.mergeFile(this.state.token!, fileHash);
      this.state.downloadUrl = downloadUrl;
      this.isMerged = true;

      this.handleUploadCompleted();

    } catch (error) {
      this.handleError(error as Error);
    }
  }

  /**
   * 处理队列中止事件
   */
  private handleQueueAborted(event: QueueAbortedEvent): void {
    this.handleError(event.error);
  }

  /**
   * 处理分片检查
   */
  private async handleChunkCheck(hash: string): Promise<boolean> {
    return await this.apiClient.checkChunk(this.state.token!, hash);
  }

  /**
   * 处理分片上传
   */
  private async handleChunkUpload(chunk: ChunkInfo & { hash: string }): Promise<void> {
    await this.apiClient.uploadChunk(this.state.token!, chunk);
    this.state.progress.chunksUploaded++;
    this.notifyProgress();
  }

  /**
   * 从分片Hash增量计算文件Hash
   */
  private calculateFileHashFromChunks(): string {
    const spark = new SparkMD5();
    
    for (const chunkHash of this.chunkHashes) {
      if (chunkHash) {
        spark.append(chunkHash);
      }
    }
    
    return spark.end().toLowerCase();
  }

  /**
   * 处理上传完成
   */
  private handleUploadCompleted(): void {
    this.state.status = 'completed';
    this.notifyProgress();

    if (this.options.onCompleted && this.state.downloadUrl) {
      this.options.onCompleted(this.state.downloadUrl);
    }
  }

  /**
   * 处理错误
   */
  private handleError(error: Error): void {
    this.state.status = 'failed';
    this.state.error = error;
    this.notifyProgress();

    if (this.options.onError) {
      this.options.onError(error);
    }
  }

  /**
   * 通知进度更新
   */
  private notifyProgress(): void {
    if (this.options.onProgress) {
      this.options.onProgress({ ...this.state });
    }
  }

  /**
   * 重置状态
   */
  private resetState(): void {
    this.state = {
      status: 'idle',
      progress: {
        chunksHashed: 0,
        chunksUploaded: 0,
        totalChunks: 0
      }
    };
    this.chunkHashes = [];
    this.isMerged = false;
  }

  /**
   * 获取当前状态
   */
  getState(): UploaderState {
    return { ...this.state };
  }

  /**
   * 终止上传
   */
  abort(): void {
    this.workerManager.terminate();
    this.state.status = 'failed';
    this.state.error = new Error('Upload aborted by user');
    this.notifyProgress();
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