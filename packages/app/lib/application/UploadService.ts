/**
 * 上传服务 - 应用服务层
 * 提供高级API并协调各个领域服务完成上传流程
 */

import { EventBusInterface } from '../infrastructure/EventBus'
import { NetworkAdapterInterface } from '../infrastructure/NetworkAdapter'
import { FileProcessorInterface } from '../domain/FileProcessor'
import { ChunkManagerInterface } from '../domain/ChunkManager'
import { HashCalculatorInterface } from '../domain/HashCalculator'
import { StateManagerInterface } from '../domain/StateManager'
import { UploadSchedulerInterface, TaskExecutor, UploadTask } from '../domain/UploadScheduler'
import { SessionManagerInterface, UploadSession } from '../domain/SessionManager'
import { UploadOptions, SessionStatus } from '../data-access/entities'

export interface UploadServiceOptions extends UploadOptions {
  enableSecondUpload?: boolean
  enableResume?: boolean
  enableProgress?: boolean
  enableRetry?: boolean
  onProgress?: (progress: UploadProgress) => void
  onError?: (error: UploadError) => void
  onComplete?: (result: UploadResult) => void
}

export interface UploadProgress {
  sessionId: string
  uploadedSize: number
  totalSize: number
  uploadedChunks: number
  totalChunks: number
  percentage: number
  speed: number
  remainingTime: number
  status: SessionStatus
}

export interface UploadResult {
  sessionId: string
  fileId: string
  url?: string
  hash: string
  size: number
  duration: number
  averageSpeed: number
  chunkCount: number
}

export interface UploadError {
  sessionId: string
  code: string
  message: string
  details?: any
  retryable: boolean
}

export enum UploadStatus {
  IDLE = 'idle',
  PREPARING = 'preparing',
  UPLOADING = 'uploading',
  PAUSED = 'paused',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled'
}

export interface UploadServiceInterface {
  // 开始上传
  startUpload(file: File, options?: UploadServiceOptions): Promise<UploadSession>
  // 暂停上传
  pauseUpload(sessionId: string): Promise<void>
  // 恢复上传
  resumeUpload(sessionId: string): Promise<void>
  // 取消上传
  cancelUpload(sessionId: string): Promise<void>
  // 获取上传状态
  getUploadStatus(sessionId: string): Promise<UploadStatus>
  // 获取上传进度
  getUploadProgress(sessionId: string): Promise<UploadProgress | undefined>
  // 重试上传
  retryUpload(sessionId: string): Promise<void>
  // 获取所有上传会话
  getAllUploads(): Promise<UploadSession[]>
  // 清理已完成的上传
  cleanupCompletedUploads(): Promise<number>
}

export class UploadService implements UploadServiceInterface, TaskExecutor {
  private fileProcessor: FileProcessorInterface
  private chunkManager: ChunkManagerInterface
  private hashCalculator: HashCalculatorInterface
  private stateManager: StateManagerInterface
  private uploadScheduler: UploadSchedulerInterface
  private sessionManager: SessionManagerInterface
  private networkAdapter: NetworkAdapterInterface
  private eventBus: EventBusInterface

  constructor(
    fileProcessor: FileProcessorInterface,
    chunkManager: ChunkManagerInterface,
    hashCalculator: HashCalculatorInterface,
    stateManager: StateManagerInterface,
    uploadScheduler: UploadSchedulerInterface,
    sessionManager: SessionManagerInterface,
    networkAdapter: NetworkAdapterInterface,
    eventBus: EventBusInterface
  ) {
    this.fileProcessor = fileProcessor
    this.chunkManager = chunkManager
    this.hashCalculator = hashCalculator
    this.stateManager = stateManager
    this.uploadScheduler = uploadScheduler
    this.sessionManager = sessionManager
    this.networkAdapter = networkAdapter
    this.eventBus = eventBus

    this.setupEventListeners()
  }

  // 允许在外部初始化后再注入调度器
  setUploadScheduler(uploadScheduler: UploadSchedulerInterface): void {
    this.uploadScheduler = uploadScheduler
  }

  async startUpload(file: File, options: UploadServiceOptions = {}): Promise<UploadSession> {
    try {
      // 1. 文件预处理和验证
      this.eventBus.emit('upload:started', { fileName: file.name, fileSize: file.size })
      
      const processedFile = await this.fileProcessor.preprocessFile(file)
      
      // 2. 创建上传会话
      const session = await this.sessionManager.createSession(file, options)
      
      // 3. 保存会话状态
      this.stateManager.setState(`session:${session.id}`, {
        status: UploadStatus.PREPARING,
        file: processedFile,
        options,
        startTime: Date.now()
      })

      // 4. 创建文件分片（快速操作）
      const chunks = await this.chunkManager.createChunks(
        file, 
        session.id, 
        { chunkSize: options.chunkSize }
      )

      // 5. 创建文件记录（使用临时hash）
      const tempHash = `temp_${session.id}_${Date.now()}`
      const createFileResult = await this.createFileOnServer(session, processedFile, tempHash, chunks.length)
      
      // 6. 更新会话token并开始上传
      await this.sessionManager.updateSession(session.id, { 
        token: createFileResult.token,
        status: SessionStatus.ACTIVE 
      })

      this.stateManager.setState(`session:${session.id}`, {
        status: UploadStatus.UPLOADING,
        token: createFileResult.token,
        tempHash
      })

      // 根据配置设置并发数（如果提供）
      if (typeof options.concurrency === 'number' && this.uploadScheduler && (this.uploadScheduler as any).setConcurrency) {
        this.uploadScheduler.setConcurrency(options.concurrency!)
      }

      // 7. 立即开始分片上传（不等待整体hash）
      this.uploadScheduler.scheduleUpload(chunks)

      this.eventBus.emit('upload:scheduled', {
        sessionId: session.id,
        chunkCount: chunks.length,
        message: 'Upload started without waiting for file hash'
      })

      // 8. 并行计算文件哈希
      this.calculateFileHashAsync(file, session.id, options.enableSecondUpload !== false)

      return session

    } catch (error) {
      const uploadError: UploadError = {
        sessionId: '',
        code: 'UPLOAD_START_FAILED',
        message: error instanceof Error ? error.message : 'Unknown error',
        retryable: true
      }

      this.eventBus.emit('upload:error', uploadError)
      throw error
    }
  }

  /**
   * 异步计算文件hash，不阻塞上传流程
   */
  private async calculateFileHashAsync(file: File, sessionId: string, enableSecondUpload: boolean): Promise<void> {
    try {
      // 并行计算文件哈希
      const fileHash = await this.hashCalculator.calculateFileHashIncremental(
        file,
        'md5',
        (progress) => {
          this.eventBus.emit('upload:hash:progress', {
            sessionId,
            progress: progress.percentage
          })
        }
      )

      // 更新会话状态
      this.stateManager.setState(`session:${sessionId}`, {
        fileHash: fileHash.hash
      })

      this.eventBus.emit('upload:hash:completed', {
        sessionId,
        hash: fileHash.hash,
        computeTime: fileHash.computeTime
      })

      // 检查秒传
      if (enableSecondUpload) {
        const secondUploadResult = await this.checkSecondUploadByHash(fileHash.hash, file.size, sessionId)
        if (secondUploadResult) {
          // 取消当前上传
          this.uploadScheduler.cancelSession(sessionId)
          await this.completeUpload(sessionId, secondUploadResult)
          return
        }
      }

      // 更新服务器文件hash
      await this.updateFileHashOnServer(sessionId, fileHash.hash)

    } catch (error) {
      this.eventBus.emit('upload:hash:failed', {
        sessionId,
        error: error instanceof Error ? error.message : 'Hash calculation failed'
      })
      // hash计算失败不影响上传继续进行
    }
  }

  async pauseUpload(sessionId: string): Promise<void> {
    const session = await this.sessionManager.getSession(sessionId)
    if (!session) {
      throw new Error(`Session ${sessionId} not found`)
    }

    await this.sessionManager.pauseSession(sessionId)
    this.uploadScheduler.cancelSession(sessionId)
    
    this.stateManager.setState(`session:${sessionId}`, {
      status: UploadStatus.PAUSED
    })

    this.eventBus.emit('upload:paused', { sessionId })
  }

  async resumeUpload(sessionId: string): Promise<void> {
    const session = await this.sessionManager.getSession(sessionId)
    if (!session) {
      throw new Error(`Session ${sessionId} not found`)
    }

    await this.sessionManager.resumeSession(sessionId)
    
    // 获取待上传的分片
    const pendingChunks = await this.chunkManager.getPendingChunks(sessionId)
    if (pendingChunks.length > 0) {
      this.uploadScheduler.scheduleUpload(pendingChunks)
    }

    this.stateManager.setState(`session:${sessionId}`, {
        status: UploadStatus.UPLOADING
      })

    this.eventBus.emit('upload:resumed', { sessionId })
  }

  async cancelUpload(sessionId: string): Promise<void> {
    const session = await this.sessionManager.getSession(sessionId)
    if (!session) {
      return
    }

    this.uploadScheduler.cancelSession(sessionId)
    await this.sessionManager.destroySession(sessionId)
    await this.chunkManager.cleanupChunks(sessionId)
    
    this.stateManager.deleteState(`session:${sessionId}`)

    this.eventBus.emit('upload:cancelled', { sessionId })
  }

  async getUploadStatus(sessionId: string): Promise<UploadStatus> {
    const sessionState = this.stateManager.getState(`session:${sessionId}`) as any
    return sessionState?.status || UploadStatus.IDLE
  }

  async getUploadProgress(sessionId: string): Promise<UploadProgress | undefined> {
    const session = await this.sessionManager.getSession(sessionId)
    if (!session) {
      return undefined
    }

    const stats = await this.chunkManager.getUploadStats(sessionId)

    return {
      sessionId,
      uploadedSize: stats.uploadedSize,
      totalSize: stats.totalSize,
      uploadedChunks: stats.completedChunks,
      totalChunks: stats.totalChunks,
      percentage: stats.progress,
      speed: stats.averageSpeed,
      remainingTime: stats.estimatedTime,
      status: session.status
    }
  }

  async retryUpload(sessionId: string): Promise<void> {
    const session = await this.sessionManager.getSession(sessionId)
    if (!session) {
      throw new Error(`Session ${sessionId} not found`)
    }

    // 获取失败的分片
    const failedChunks = await this.chunkManager.getFailedChunks(sessionId)
    
    // 重置失败分片的状态
    const chunkIds = failedChunks.map(chunk => chunk.id)
    await this.chunkManager.batchResetChunks(chunkIds)

    // 重新调度上传
    const retryableChunks = await this.chunkManager.getRetryableChunks(sessionId)
    if (retryableChunks.length > 0) {
      this.uploadScheduler.scheduleUpload(retryableChunks)
    }

    this.eventBus.emit('upload:retry', {
      sessionId,
      retryChunkCount: retryableChunks.length
    })
  }

  async getAllUploads(): Promise<UploadSession[]> {
    return await this.sessionManager.getActiveSessions()
  }

  async cleanupCompletedUploads(): Promise<number> {
    const completedSessions = await this.sessionManager.findSessionsByStatus(SessionStatus.COMPLETED)
    let cleanedCount = 0

    for (const session of completedSessions) {
      const sessionAge = Date.now() - session.updatedAt
      if (sessionAge > 24 * 60 * 60 * 1000) { // 24小时后清理
        await this.sessionManager.destroySession(session.id)
        await this.chunkManager.cleanupChunks(session.id)
        this.stateManager.deleteState(`session:${session.id}`)
        cleanedCount++
      }
    }

    return cleanedCount
  }

  // TaskExecutor 接口实现
  async execute(task: UploadTask): Promise<void> {
    const sessionState = this.stateManager.getState(`session:${task.sessionId}`) as any
    if (!sessionState) {
      throw new Error(`Session ${task.sessionId} not found`)
    }

    const file = sessionState.file.file
    const token = sessionState.token

    // 获取分片数据
    const chunkBlob = await this.chunkManager.getChunkBlob(file, task.chunkId)
    
    // 上传分片
    const uploadResult = await this.networkAdapter.uploadChunk({
      url: `${sessionState.options.baseURL || ''}/file/uploadChunk`,
      file: chunkBlob,
      token,
      hash: (await this.chunkManager.getChunkInfo(task.chunkId))!.hash,
      start: (await this.chunkManager.getChunkInfo(task.chunkId))!.start,
      end: (await this.chunkManager.getChunkInfo(task.chunkId))!.end,
      index: (await this.chunkManager.getChunkInfo(task.chunkId))!.index
    })

    if (uploadResult.status === 'ok') {
      await this.chunkManager.markChunkCompleted(task.chunkId)
      
      // 检查是否所有分片都已完成
      const stats = await this.chunkManager.getUploadStats(task.sessionId)
      if (stats.completedChunks === stats.totalChunks) {
        await this.mergeFile(task.sessionId)
      }
    } else {
      throw new Error(`Upload failed: ${uploadResult.message || 'Unknown error'}`)
    }
  }

  canExecute(task: UploadTask): boolean {
    const sessionState = this.stateManager.getState(`session:${task.sessionId}`) as any
    return sessionState && sessionState.status === UploadStatus.UPLOADING
  }

  getEstimatedTime(task: UploadTask): number {
    // 基于分片大小和网络速度估算时间
    const sessionState = this.stateManager.getState(`session:${task.sessionId}`) as any
    const chunkSize = sessionState?.file?.chunkSize || 5 * 1024 * 1024
    const estimatedSpeed = 1024 * 1024 // 1MB/s
    return Math.ceil(chunkSize / estimatedSpeed) * 1000 // 转换为毫秒
  }

  private async checkSecondUploadByHash(hash: string, size: number, sessionId: string): Promise<UploadResult | null> {
    try {
      const sessionState = this.stateManager.getState(`session:${sessionId}`) as any
      const baseURL = sessionState?.options?.baseURL || ''

      // 检查服务器是否已有此文件
      const checkResult = await this.networkAdapter.request({
        url: `${baseURL}/file/patchHash`,
        method: 'POST',
        body: { token: sessionState?.token, hash, type: 'file' }
      }) as any

      if (checkResult?.status === 'ok' && checkResult.hasFile) {
        return {
          sessionId,
          fileId: `file_${sessionId}`,
          url: checkResult.url,
          hash,
          size,
          duration: 0,
          averageSpeed: 0,
          chunkCount: 0
        }
      }

      return null
    } catch (error) {
      // 秒传检查失败，继续正常上传流程
      return null
    }
  }

  private async updateFileHashOnServer(sessionId: string, hash: string): Promise<void> {
    try {
      // 服务器在合并时更新 hash，这里仅做事件通知与状态维护
      const sessionState = this.stateManager.getState(`session:${sessionId}`) as any
      this.stateManager.setState(`session:${sessionId}`, {
        ...sessionState,
        fileHash: hash
      })

      this.eventBus.emit('upload:hash:updated', {
        sessionId,
        hash
      })

    } catch (error) {
      this.eventBus.emit('upload:hash:update:failed', {
        sessionId,
        error: error instanceof Error ? error.message : 'Hash update failed'
      })
    }
  }

  private async createFileOnServer(_session: UploadSession, processedFile: any, fileHash: string, chunkCount: number): Promise<{ token: string }> {
    const sessionState = this.stateManager.getState(`session:${_session.id}`) as any
    const baseURL = sessionState?.options?.baseURL || ''
    const result = await this.networkAdapter.request({
      url: `${baseURL}/file/create`,
      method: 'POST',
      body: {
        name: processedFile.metadata.name,
        type: processedFile.metadata.type,
        size: processedFile.metadata.size,
        hash: fileHash,
        chunksLength: chunkCount
      }
    }) as any

    return { token: result.token }
  }

  private async mergeFile(sessionId: string): Promise<void> {
    const sessionState = this.stateManager.getState(`session:${sessionId}`) as any
    if (!sessionState) {
      throw new Error(`Session ${sessionId} not found`)
    }

    try {
      const baseURL = sessionState?.options?.baseURL || ''
      const mergeResult = await this.networkAdapter.request({
        url: `${baseURL}/file/merge`,
        method: 'POST',
        body: {
          token: sessionState.token,
          hash: sessionState.fileHash
        }
      }) as any

      if (mergeResult.status === 'ok') {
        await this.completeUpload(sessionId, {
          sessionId,
          fileId: `file_${sessionId}`,
          url: mergeResult.url,
          hash: sessionState.fileHash,
          size: sessionState.file.metadata.size,
          duration: Date.now() - sessionState.startTime,
          averageSpeed: sessionState.file.metadata.size / ((Date.now() - sessionState.startTime) / 1000),
          chunkCount: sessionState.file.chunks
        })
      } else {
        throw new Error(`Merge failed: ${mergeResult.message}`)
      }
    } catch (error) {
      await this.failUpload(sessionId, error)
    }
  }

  private async completeUpload(sessionId: string, result: UploadResult): Promise<void> {
    await this.sessionManager.completeSession(sessionId)
    
    this.stateManager.setState(`session:${sessionId}`, {
      status: UploadStatus.COMPLETED,
      result
    })

    this.eventBus.emit('upload:completed', result)
  }

  private async failUpload(sessionId: string, error: any): Promise<void> {
    const uploadError: UploadError = {
      sessionId,
      code: 'UPLOAD_FAILED',
      message: error instanceof Error ? error.message : 'Unknown error',
      details: error,
      retryable: true
    }

    this.stateManager.setState(`session:${sessionId}`, {
      status: UploadStatus.FAILED,
      error: uploadError
    })

    this.eventBus.emit('upload:failed', uploadError)
  }

  private setupEventListeners(): void {
    // 监听分片完成事件
    this.eventBus.on('chunk:completed', async (data) => {
      const progress = await this.getUploadProgress(data.sessionId)
      if (progress) {
        this.eventBus.emit('upload:progress', progress)
      }
    })

    // 监听分片失败事件
    this.eventBus.on('chunk:failed', async (data) => {
      const uploadError: UploadError = {
        sessionId: data.sessionId,
        code: 'CHUNK_UPLOAD_FAILED',
        message: data.error,
        retryable: data.retryCount < 3
      }

      this.eventBus.emit('upload:chunk:error', uploadError)
    })

    // 监听会话过期事件
    this.eventBus.on('session:expired', async (data) => {
      await this.cancelUpload(data.sessionId)
    })
  }
}

/**
 * 上传服务工厂
 */
export class UploadServiceFactory {
  static create(
    fileProcessor: FileProcessorInterface,
    chunkManager: ChunkManagerInterface,
    hashCalculator: HashCalculatorInterface,
    stateManager: StateManagerInterface,
    uploadScheduler: UploadSchedulerInterface,
    sessionManager: SessionManagerInterface,
    networkAdapter: NetworkAdapterInterface,
    eventBus: EventBusInterface
  ): UploadService {
    return new UploadService(
      fileProcessor,
      chunkManager,
      hashCalculator,
      stateManager,
      uploadScheduler,
      sessionManager,
      networkAdapter,
      eventBus
    )
  }
}