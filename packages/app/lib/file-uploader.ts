/**
 * 文件上传器
 * 协调整个上传流程，严格按照文档描述的流程逻辑执行
 */

import { WorkerManager } from './worker-manager'
import { UploadQueue } from './upload-queue'
import { ApiClient } from './api-client'
import SparkMD5 from 'spark-md5'

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
  ChunkInfo,
} from './types'

export interface FileUploaderOptions {
  config: UploadConfig
  onProgress?: (state: UploaderState) => void
  onCompleted?: (downloadUrl: string) => void
  onError?: (error: Error) => void
}

export class FileUploader implements EventEmitter {
  // ============ 依赖组件 ============

  private workerManager: WorkerManager
  private uploadQueue: UploadQueue
  private apiClient: ApiClient
  private options: FileUploaderOptions

  // ============ 状态管理 ============

  private state: UploaderState = {
    status: 'idle',
    progress: {
      chunksHashed: 0,
      chunksUploaded: 0,
      totalChunks: 0,
    },
  }

  private listeners: Map<string, Set<Function>> = new Map()
  private chunkHashes: string[] = []
  private isMerged = false
  private currentFileInfo?: FileInfo

  // ============ 构造函数 ============

  constructor(options: FileUploaderOptions) {
    this.options = options
    this.apiClient = new ApiClient(options.config.baseUrl)
    this.workerManager = new WorkerManager()

    this.uploadQueue = new UploadQueue({
      concurrency: options.config.concurrency,
      onChunkCheck: this.handleChunkCheck.bind(this),
      onChunkUpload: this.handleChunkUpload.bind(this),
    })

    this.setupEventListeners()
  }

  // ============ 公共方法 ============

  async upload(file: File): Promise<void> {
    try {
      this.checkBeforeUpload(file)
      this.resetState()
      this.currentFileInfo = this.getFileInfoByFile(file)
      this.initState(file)
      this.notifyProgress()

      await this.createSession(file, this.currentFileInfo)

      await this.workerManager.startHashing(file, this.options.config.chunkSize)
    } catch (error) {
      this.handleError(error as Error)
    }
  }

  getState(): UploaderState {
    return { ...this.state }
  }

  abort(): void {
    this.workerManager.terminate()
    this.state.status = 'failed'
    this.state.error = new Error('Upload aborted by user')
    this.notifyProgress()
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

  // ============ 初始化相关 ============

  private setupEventListeners(): void {
    this.workerManager.on<ChunkHashedEvent>(
      'ChunkHashed',
      this.handleChunkHashed.bind(this)
    )
    this.workerManager.on<AllChunksHashedEvent>(
      'AllChunksHashed',
      this.handleAllChunksHashed.bind(this)
    )
    this.workerManager.on<FileHashedEvent>(
      'FileHashed',
      this.handleFileHashed.bind(this)
    )
    this.workerManager.on<QueueAbortedEvent>(
      'QueueAborted',
      this.handleQueueAborted.bind(this)
    )

    this.uploadQueue.on<QueueDrainedEvent>(
      'QueueDrained',
      this.handleQueueDrained.bind(this)
    )
    this.uploadQueue.on<QueueAbortedEvent>(
      'QueueAborted',
      this.handleQueueAborted.bind(this)
    )
  }

  private checkBeforeUpload(file: File): void {
    if (!file) {
      throw new Error('File is required')
    }
    if (file.size === 0) {
      throw new Error('File size is 0')
    }
  }

  private getFileInfoByFile(file: File): FileInfo {
    return {
      name: file.name,
      size: file.size,
      type: file.type,
    }
  }

  private initState(file: File): void {
    this.state.status = 'uploading'
    this.state.progress.totalChunks = Math.ceil(
      file.size / this.options.config.chunkSize
    )
  }

  private async createSession(file: File, fileInfo: FileInfo): Promise<void> {
    const response = await this.apiClient.createSession({
      fileName: fileInfo.name,
      fileSize: fileInfo.size,
      fileType: fileInfo.type,
      chunksLength: Math.ceil(file.size / this.options.config.chunkSize),
    })

    this.state.token = response.token
  }

  // ============ 事件处理 ============

  private handleChunkHashed(event: ChunkHashedEvent): void {
    this.chunkHashes[event.chunk.index] = event.chunk.hash
    this.state.progress.chunksHashed++
    this.notifyProgress()

    this.uploadQueue.addChunkTask(event.chunk)
  }

  private handleAllChunksHashed(_event: AllChunksHashedEvent): void {
    this.uploadQueue.markAllChunksHashed()
  }

  private async handleFileHashed(event: FileHashedEvent): Promise<void> {
    if (this.isMerged) {
      return
    }

    try {
      this.state.fileHash = event.fileHash

      const exists = await this.apiClient.checkFile(
        this.state.token!,
        event.fileHash
      )

      if (exists) {
        this.workerManager.terminate()

        if (!this.uploadQueue.isCompleted) {
          this.state.progress.chunksHashed = this.state.progress.totalChunks
          this.state.progress.chunksUploaded = this.state.progress.totalChunks

          this.uploadQueue.markAsCompleted()
        }
      }
    } catch (error) {
      this.handleError(error as Error)
    }
  }

  private async handleQueueDrained(_event: QueueDrainedEvent): Promise<void> {
    try {
      if (this.isMerged) {
        return
      }

      // 检查是否需要计算文件Hash
      let fileHash = this.state.fileHash
      if (!fileHash) {
        // 增量计算文件Hash
        fileHash = this.calculateFileHashFromChunks()
        this.state.fileHash = fileHash
      }

      const chunks = this.chunkHashes.map((hash, index) => ({
        index,
        hash,
      }))

      const downloadUrl = await this.apiClient.mergeFile(
        this.state.token!,
        fileHash,
        this.currentFileInfo!.name,
        chunks
      )
      this.state.downloadUrl = downloadUrl
      this.isMerged = true

      this.handleUploadCompleted()
    } catch (error) {
      this.handleError(error as Error)
    }
  }

  private handleQueueAborted(event: QueueAbortedEvent): void {
    this.handleError(event.error)
  }

  private async handleChunkCheck(hash: string): Promise<boolean> {
    const exists = await this.apiClient.checkChunk(this.state.token!, hash)

    // 如果分片已存在，且没有完成上传
    if (
      exists &&
      !(this.state.progress.chunksUploaded === this.state.progress.totalChunks)
    ) {
      this.state.progress.chunksUploaded++
      this.notifyProgress()
    }

    return exists
  }

  private async handleChunkUpload(
    chunk: ChunkInfo & { hash: string }
  ): Promise<void> {
    await this.apiClient.uploadChunk(this.state.token!, chunk)
    this.state.progress.chunksUploaded++
    this.notifyProgress()
  }

  // ============ Hash计算 ============

  private calculateFileHashFromChunks(): string {
    const spark = new SparkMD5()

    for (const chunkHash of this.chunkHashes) {
      if (chunkHash) {
        spark.append(chunkHash)
      }
    }

    return spark.end().toLowerCase()
  }

  // ============ 状态管理 ============

  private handleUploadCompleted(): void {
    this.state.status = 'completed'
    this.notifyProgress()

    if (this.options.onCompleted && this.state.downloadUrl) {
      this.options.onCompleted(this.state.downloadUrl)
    }
  }

  private handleError(error: Error): void {
    this.state.status = 'failed'
    this.state.error = error
    this.notifyProgress()

    if (this.options.onError) {
      this.options.onError(error)
    }
  }

  private notifyProgress(): void {
    if (this.options.onProgress) {
      this.options.onProgress({ ...this.state })
    }
  }

  private resetState(): void {
    this.state = {
      status: 'idle',
      progress: {
        chunksHashed: 0,
        chunksUploaded: 0,
        totalChunks: 0,
      },
    }
    this.chunkHashes = []
    this.isMerged = false
    this.currentFileInfo = undefined
  }
}
