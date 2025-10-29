/**
 * 上传服务 - 应用服务层
 * 提供高级API并协调各个领域服务完成上传流程
 */

import { EventBusInterface } from '../infrastructure/EventBus'
import { NetworkAdapterInterface } from '../infrastructure/NetworkAdapter'
import { RetryService, RetryConfig } from '../infrastructure/RetryService'
import { ChunkManagerInterface } from '../domain/ChunkManager'
import { HashCalculatorInterface } from '../domain/HashCalculator'
import {
  UploadSchedulerInterface,
  TaskExecutor,
  UploadTask,
} from '../domain/UploadScheduler'
import {
  SessionManagerInterface,
  UploadSession,
} from '../domain/SessionManager'
import { UploadOptions, SessionStatus } from '../data-access/entities'

// 网络请求响应接口定义
interface PatchHashResponse {
  status?: string
  hasFile?: boolean
  exists?: boolean
  url?: string
  message?: string
}

interface CreateFileResponse {
  token: string
  fileId?: string
}

interface MergeFileResponse {
  status?: string
  fileId: string
  url?: string
  message?: string
}

export interface UploadServiceOptions extends UploadOptions {
  enableResume?: boolean
  enableProgress?: boolean
  enableRetry?: boolean
  retryConfig?: Partial<RetryConfig>
  // 是否使用 Web Worker 进行哈希计算
  useWorker?: boolean
  // Worker 脚本的可访问 URL（必填于 useWorker=true 时）
  workerScriptURL?: string
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
  details?: Record<string, unknown>
  retryable: boolean
}

export enum UploadStatus {
  IDLE = 'idle',
  PREPARING = 'preparing',
  UPLOADING = 'uploading',
  PAUSED = 'paused',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

export interface UploadServiceInterface {
  // 开始上传
  startUpload(
    file: File,
    options?: UploadServiceOptions
  ): Promise<UploadSession>
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
  private chunkManager: ChunkManagerInterface
  private hashCalculator: HashCalculatorInterface
  private uploadScheduler: UploadSchedulerInterface
  private sessionManager: SessionManagerInterface
  private networkAdapter: NetworkAdapterInterface
  private eventBus: EventBusInterface
  private retryService: RetryService
  private sessionFiles: Map<string, File> = new Map() // 存储session对应的文件

  constructor(
    chunkManager: ChunkManagerInterface,
    hashCalculator: HashCalculatorInterface,
    uploadScheduler: UploadSchedulerInterface | undefined,
    sessionManager: SessionManagerInterface,
    networkAdapter: NetworkAdapterInterface,
    eventBus: EventBusInterface
  ) {
    this.chunkManager = chunkManager
    this.hashCalculator = hashCalculator
    this.uploadScheduler = uploadScheduler!
    this.sessionManager = sessionManager
    this.networkAdapter = networkAdapter
    this.eventBus = eventBus
    this.retryService = new RetryService(eventBus)

    this.setupEventListeners()
  }

  // 允许在外部初始化后再注入调度器
  setUploadScheduler(uploadScheduler: UploadSchedulerInterface): void {
    this.uploadScheduler = uploadScheduler
  }

  // 配置重试机制
  configureRetry(config: Partial<RetryConfig>): void {
    this.retryService.updateConfig(config)
    this.eventBus.emit('upload:retry:configured', { config })
  }

  // 获取重试服务实例
  getRetryService(): RetryService {
    return this.retryService
  }

  // 获取session对应的文件
  private getSessionFile(sessionId: string): File | undefined {
    return this.sessionFiles.get(sessionId)
  }

  // 清理session文件映射
  private cleanupSessionFile(sessionId: string): void {
    this.sessionFiles.delete(sessionId)
  }

  async startUpload(
    file: File,
    options: UploadServiceOptions = {}
  ): Promise<UploadSession> {
    try {
      // 1. 发出上传开始事件
      this.eventBus.emit('upload:started', {
        fileName: file.name,
        fileSize: file.size,
      })

      // 2. 创建上传会话
      const session = await this.sessionManager.createSession(options)
      
      // 存储文件对象到映射中
      this.sessionFiles.set(session.id, file)
      
      await this.sessionManager.updateSession(session.id, {
        status: SessionStatus.ACTIVE,
      })

      // 3. 创建文件分片（快速操作）
      const chunks = await this.chunkManager.createChunks(file, session.id, {
        chunkSize: options.chunkSize,
      })

      // 4. 创建文件记录（使用临时hash）
      const tempHash = `temp_${session.id}_${Date.now()}`
      const createFileResult = await this.createFileOnServer(
        session,
        file,
        tempHash,
        chunks.length
      )

      // 5. 更新会话token和状态
      await this.sessionManager.updateSession(session.id, {
        token: createFileResult.token,
        status: SessionStatus.ACTIVE,
      })

      // 6. 设置并发数（如果提供）
      if (typeof options.concurrency === 'number' && this.uploadScheduler) {
        this.uploadScheduler.setConcurrency(options.concurrency)
      }

      // 6.1 配置哈希计算器（chunkSize/useWorker/workerScriptURL）
      try {
        const hashChunkSize = options.chunkSize ?? session.options?.chunkSize
        const calcOptions: any = {}
        if (hashChunkSize) calcOptions.chunkSize = hashChunkSize
        if (typeof options.useWorker === 'boolean') calcOptions.useWorker = options.useWorker
        if (options.workerScriptURL) calcOptions.workerScriptURL = options.workerScriptURL
        if (Object.keys(calcOptions).length > 0) this.hashCalculator.setOptions(calcOptions)
      } catch {}

      // 7. 立即开始分片上传（不等待整体hash）
      this.uploadScheduler.scheduleUpload(chunks)

      this.eventBus.emit('upload:scheduled', {
        sessionId: session.id,
        chunkCount: chunks.length,
        message: 'Upload started without waiting for file hash',
      })

      // 8. 异步并行计算所有分片真实哈希并发射事件，驱动“秒传”检查
      // 不阻塞上传主流程
      this.computeChunkHashes(session.id).catch((e) => {
        this.eventBus.emit('chunk:hash:all:failed', {
          sessionId: session.id,
          error: e instanceof Error ? e.message : String(e),
        })
      })

      return session
    } catch (error) {
      const uploadError: UploadError = {
        sessionId: '',
        code: 'UPLOAD_START_FAILED',
        message: error instanceof Error ? error.message : 'Unknown error',
        retryable: true,
      }

      this.eventBus.emit('upload:error', uploadError)
      throw error
    }
  }

  // 异步计算当前会话下所有分片的真实哈希，逐个发射 chunk:hash:calculated，完成后发射 chunk:hash:all:completed
  private async computeChunkHashes(sessionId: string): Promise<void> {
    const session = await this.sessionManager.getSession(sessionId)
    if (!session) return

    const file = this.getSessionFile(sessionId)
    if (!file) return

    const chunks = await this.chunkManager.getSessionChunks(sessionId)
    // 按 index 顺序
    const ordered = [...chunks].sort((a, b) => a.index - b.index)

    // 简单并发限制
    const maxParallel = 4
    let cursor = 0
    const runNext = async (): Promise<void> => {
      if (cursor >= ordered.length) return
      const current = ordered[cursor++]
      try {
        // 仅对临时哈希的分片计算真实哈希
        if (current.hash && current.hash.startsWith('temp_')) {
          const blob = await this.chunkManager.getChunkBlob(file, current.id)
          const real = await this.hashCalculator.calculateChunkHash(blob)
          await this.chunkManager.updateChunkHash(current.id, real)

          this.eventBus.emit('chunk:hash:calculated', {
            sessionId,
            chunkId: current.id,
            hash: real,
          })
        }
      } catch (e) {
        this.eventBus.emit('chunk:hash:calculate:failed', {
          sessionId,
          chunkId: current.id,
          error: e instanceof Error ? e.message : 'Unknown error',
        })
      } finally {
        // 递归推进
        await runNext()
      }
    }

    // 启动并发 worker
    const starters = Array.from({ length: Math.min(maxParallel, ordered.length) }, () => runNext())
    await Promise.all(starters)

    this.eventBus.emit('chunk:hash:all:completed', { sessionId })
  }

  async pauseUpload(sessionId: string): Promise<void> {
    const session = await this.sessionManager.getSession(sessionId)
    if (!session) {
      throw new Error(`Session ${sessionId} not found`)
    }

    await this.sessionManager.pauseSession(sessionId)
    this.uploadScheduler.cancelSession(sessionId)

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

    this.eventBus.emit('upload:cancelled', { sessionId })
  }

  async getUploadStatus(sessionId: string): Promise<UploadStatus> {
    const session = await this.sessionManager.getSession(sessionId)
    if (!session) {
      return UploadStatus.IDLE
    }

    switch (session.status) {
      case SessionStatus.ACTIVE:
        return UploadStatus.UPLOADING
      case SessionStatus.PAUSED:
        return UploadStatus.PAUSED
      case SessionStatus.COMPLETED:
        return UploadStatus.COMPLETED
      case SessionStatus.FAILED:
        return UploadStatus.FAILED
      default:
        return UploadStatus.IDLE
    }
  }

  async getUploadProgress(
    sessionId: string
  ): Promise<UploadProgress | undefined> {
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
      status: session.status,
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
    const chunkIds = failedChunks.map((chunk) => chunk.id)
    await this.chunkManager.batchResetChunks(chunkIds)

    // 重新调度上传
    const retryableChunks =
      await this.chunkManager.getRetryableChunks(sessionId)
    if (retryableChunks.length > 0) {
      this.uploadScheduler.scheduleUpload(retryableChunks)
    }

    this.eventBus.emit('upload:retry', {
      sessionId,
      retryChunkCount: retryableChunks.length,
    })
  }

  async getAllUploads(): Promise<UploadSession[]> {
    return await this.sessionManager.getActiveSessions()
  }

  async cleanupCompletedUploads(): Promise<number> {
    const completedSessions = await this.sessionManager.findSessionsByStatus(
      SessionStatus.COMPLETED
    )
    let cleanedCount = 0

    for (const session of completedSessions) {
      const sessionAge = Date.now() - session.updatedAt
      if (sessionAge > 24 * 60 * 60 * 1000) {
        // 24小时后清理
        await this.sessionManager.destroySession(session.id)
        await this.chunkManager.cleanupChunks(session.id)
        cleanedCount++
      }
    }

    return cleanedCount
  }

  // TaskExecutor 接口实现
  async execute(task: UploadTask): Promise<void> {
    const session = await this.sessionManager.getSession(task.sessionId)
    if (!session) {
      throw new Error(`Session ${task.sessionId} not found`)
    }

    const file = this.getSessionFile(task.sessionId)
    if (!file) {
      throw new Error(`File for session ${task.sessionId} not found`)
    }
    
    const token = session.token
    if (!token) {
      throw new Error(`Token not found for session ${task.sessionId}`)
    }
    
    const baseURL = session.options?.baseURL || ''

    // 获取分片数据
    const chunkBlob = await this.chunkManager.getChunkBlob(file, task.chunkId)
    const chunkInfo = await this.chunkManager.getChunkInfo(task.chunkId)
    if (!chunkInfo) {
      throw new Error(`Chunk info ${task.chunkId} not found`)
    }

    let effectiveHash = chunkInfo.hash

    // 如果是临时哈希，计算真实哈希并更新
    if (effectiveHash.startsWith('temp_')) {
      try {
        const realHash = await this.hashCalculator.calculateChunkHash(chunkBlob)
        effectiveHash = realHash
        await this.chunkManager.updateChunkHash(task.chunkId, realHash)
      } catch (e) {
        // 如果计算失败，不阻塞上传流程，继续使用临时哈希
        this.eventBus.emit('chunk:hash:calculate:failed', {
          chunkId: task.chunkId,
          error: e instanceof Error ? e.message : 'Unknown error',
        })
      }
    }

    // 分片级秒传：在上传前检查服务器是否已有该分片（原生支持特性）
    try {
      const operation = async () =>
        await this.networkAdapter.request<PatchHashResponse>({
          url: `${baseURL}/file/patchHash`,
          method: 'POST',
          body: { token, hash: effectiveHash, type: 'chunk' },
        })

      const checkResult = await this.retryService.execute(
        operation,
        `patch_chunk_${task.chunkId}`,
        `PatchHash Chunk ${task.chunkId}`,
        session.options?.retryConfig
      )

      if (checkResult?.status === 'ok' && checkResult.hasFile) {
        // 服务器已存在该分片，跳过实际上传并标记完成
        await this.chunkManager.markChunkCompleted(task.chunkId)

        // 检查是否所有分片都已完成，触发合并
        const stats = await this.chunkManager.getUploadStats(task.sessionId)
        if (stats.completedChunks === stats.totalChunks) {
          await this.mergeFile(task.sessionId)
        }
        return
      }
    } catch (e) {
      // 检查失败不阻塞上传流程，正常继续上传
      this.eventBus.emit('chunk:second-upload:check:failed', {
        chunkId: task.chunkId,
        error: e instanceof Error ? e.message : 'Second upload check failed',
      })
    }

    // 使用重试机制上传分片
    const uploadOperation = async () => {
      const uploadResult = await this.networkAdapter.uploadChunk({
        url: `${baseURL}/file/uploadChunk`,
        file: chunkBlob,
        token,
        hash: effectiveHash,
        start: chunkInfo.start,
        end: chunkInfo.end,
        index: chunkInfo.index,
      })

      if (uploadResult.status !== 'ok') {
        throw new Error(
          `Upload failed: ${uploadResult.message || 'Unknown error'}`
        )
      }

      return uploadResult
    }

    // 执行带重试的上传操作
    await this.retryService.execute(
      uploadOperation,
      `chunk_${task.chunkId}`,
      `Chunk Upload ${task.chunkId}`,
      session.options?.retryConfig
    )

    // 标记分片完成
    await this.chunkManager.markChunkCompleted(task.chunkId)

    // 检查是否所有分片都已完成
    const stats = await this.chunkManager.getUploadStats(task.sessionId)
    if (stats.completedChunks === stats.totalChunks) {
      await this.mergeFile(task.sessionId)
    }
  }

  canExecute(task: UploadTask): boolean {
    // 简化实现：直接检查调度器中的任务状态
    return this.uploadScheduler
      ? this.uploadScheduler.hasTask(task.sessionId, task.chunkId)
      : false
  }

  getEstimatedTime(_task: UploadTask): number {
    // 基于分片大小和网络速度估算时间
    const chunkSize = 5 * 1024 * 1024 // 默认5MB
    const estimatedSpeed = 1024 * 1024 // 1MB/s
    return Math.ceil(chunkSize / estimatedSpeed) * 1000 // 转换为毫秒
  }

  private async createFileOnServer(
    session: UploadSession,
    file: File,
    fileHash: string,
    chunkCount: number
  ): Promise<{ token: string }> {
    const baseURL = session.options?.baseURL || ''
    const result = await this.networkAdapter.request<CreateFileResponse>({
      url: `${baseURL}/file/create`,
      method: 'POST',
      body: {
        name: file.name,
        type: file.type,
        size: file.size,
        hash: fileHash,
        chunksLength: chunkCount,
      },
    })

    return { token: result.token }
  }

  private async mergeFile(sessionId: string): Promise<void> {
    const session = await this.sessionManager.getSession(sessionId)
    if (!session || !session.token) {
      throw new Error(`Session ${sessionId} not found or missing token`)
    }

    try {
      const baseURL = session.options?.baseURL || ''

      // 获取文件对象
      const file = this.getSessionFile(sessionId)
      if (!file) {
        throw new Error(`File for session ${sessionId} not found`)
      }

      // 计算文件的最终哈希
      const fileHash = await this.hashCalculator.calculateFileHashIncremental(
        file
      )

      const mergeOperation = async () =>
        await this.networkAdapter.request<MergeFileResponse>({
          url: `${baseURL}/file/merge`,
          method: 'POST',
          body: {
            token: session.token,
            hash: fileHash.hash,
          },
        })

      const mergeResult = await this.retryService.execute(
        mergeOperation,
        `merge_${sessionId}`,
        `Merge File ${sessionId}`,
        session.options?.retryConfig
      )

      if (mergeResult.status === 'ok') {
        await this.completeUpload(sessionId, {
          sessionId,
          fileId: `file_${sessionId}`,
          url: mergeResult.url || undefined,
          hash: fileHash.hash,
          size: file.size,
          duration: fileHash.computeTime,
          averageSpeed: file.size / (fileHash.computeTime / 1000),
          chunkCount: await this.chunkManager
            .getUploadStats(sessionId)
            .then((stats) => stats.totalChunks),
        })
      } else {
        throw new Error(`Merge failed: ${mergeResult.message}`)
      }
    } catch (error) {
      await this.failUpload(sessionId, error instanceof Error ? error : { message: String(error) })
    }
  }

  private async completeUpload(
    sessionId: string,
    result: UploadResult
  ): Promise<void> {
    await this.sessionManager.completeSession(sessionId)
    this.cleanupSessionFile(sessionId) // 清理文件映射
    this.eventBus.emit('upload:completed', result)
  }

  private async failUpload(
    sessionId: string,
    error: Error | Record<string, unknown>
  ): Promise<void> {
    const uploadError: UploadError = {
      sessionId,
      code: 'UPLOAD_FAILED',
      message: error instanceof Error ? error.message : 'Unknown error',
      details: error instanceof Error ? { 
        name: error.name, 
        message: error.message, 
        stack: error.stack 
      } : error,
      retryable: true,
    }

    await this.sessionManager.failSession(sessionId)
    this.cleanupSessionFile(sessionId) // 清理文件映射
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
        retryable: data.retryCount < 3,
      }

      this.eventBus.emit('upload:chunk:error', uploadError)
    })

    // 监听会话过期事件
    this.eventBus.on('session:expired', async (data) => {
      await this.cancelUpload(data.sessionId)
    })

    // 监听分片哈希计算完成，进行分片级秒传检查（原生特性，无需配置）
    this.eventBus.on(
      'chunk:hash:calculated',
      async ({ sessionId, chunkId, hash }) => {
        try {
          const session = await this.sessionManager.getSession(sessionId)
          if (!session || !session.token) {
            return
          }

          const baseURL = session.options?.baseURL || ''
          const operation = async () =>
            await this.networkAdapter.request<PatchHashResponse>({
              url: `${baseURL}/file/patchHash`,
              method: 'POST',
              body: { token: session.token, hash, type: 'chunk' },
            })

          const result = await this.retryService.execute(
            operation,
            `patch_chunk_${chunkId}`,
            `PatchHash Chunk ${chunkId}`,
            session.options?.retryConfig
          )

          if (result?.status === 'ok' && result.hasFile) {
            // 标记该分片完成并尝试取消对应调度任务
            await this.chunkManager.markChunkCompleted(chunkId)

            const tasks = this.uploadScheduler.getSessionTasks(sessionId)
            tasks
              .filter((t) => t.chunkId === chunkId)
              .forEach((t) => this.uploadScheduler.cancelTask(t.id))

            this.eventBus.emit('chunk:second-upload:skipped', {
              sessionId,
              chunkId,
              reason: 'chunk exists on server',
            })

            // 如果全部完成，触发合并
            const stats = await this.chunkManager.getUploadStats(sessionId)
            if (stats.completedChunks === stats.totalChunks) {
              await this.mergeFile(sessionId)
            }
          }
        } catch (error) {
          // 秒传检查失败不阻塞
          this.eventBus.emit('chunk:second-upload:check:failed', {
            chunkId,
            error:
              error instanceof Error
                ? error.message
                : 'Second upload check failed',
          })
        }
      }
    )

    // 监听所有分片哈希计算完成，进行文件级秒传检查（原生特性，无需配置）
    this.eventBus.on('chunk:hash:all:completed', async ({ sessionId }) => {
      try {
        const session = await this.sessionManager.getSession(sessionId)
        if (!session || !session.token) {
          return
        }

        const baseURL = session.options?.baseURL || ''

        // 获取文件对象
        const file = this.getSessionFile(sessionId)
        if (!file) {
          return
        }

        // 计算整个文件的哈希（增量/Worker并行）
        const fileHash = await this.hashCalculator.calculateFileHashIncremental(
          file
        )

        const operation = async () =>
          await this.networkAdapter.request<PatchHashResponse>({
            url: `${baseURL}/file/patchHash`,
            method: 'POST',
            body: { token: session.token, hash: fileHash.hash, type: 'file' },
          })

        const result = await this.retryService.execute(
          operation,
          `patch_file_${sessionId}`,
          `PatchHash File ${sessionId}`,
          session.options?.retryConfig
        )

        if (result?.status === 'ok' && result.hasFile) {
          // 取消该会话的所有任务
          this.uploadScheduler.cancelSession(sessionId)

          // 完成会话（秒传）
          const file = this.getSessionFile(sessionId)
          if (!file) {
            throw new Error(`File not found for session ${sessionId}`)
          }

          await this.completeUpload(sessionId, {
            sessionId,
            fileId: `file_${sessionId}`,
            url: result.url || undefined,
            hash: fileHash.hash,
            size: file.size,
            duration: fileHash.computeTime,
            averageSpeed:
              file.size / (Math.max(1, fileHash.computeTime) / 1000),
            chunkCount: await this.chunkManager
              .getUploadStats(sessionId)
              .then((stats) => stats.totalChunks),
          })

          this.eventBus.emit('upload:second-upload:file:skipped', {
            sessionId,
            reason: 'file exists on server',
          })
        }
      } catch (error) {
        this.eventBus.emit('file:second-upload:check:failed', {
          sessionId,
          error:
            error instanceof Error
              ? error.message
              : 'Second upload check failed',
        })
      }
    })
  }
}

/**
 * 上传服务工厂
 */
export class UploadServiceFactory {
  static create(
    chunkManager: ChunkManagerInterface,
    hashCalculator: HashCalculatorInterface,
    uploadScheduler: UploadSchedulerInterface,
    sessionManager: SessionManagerInterface,
    networkAdapter: NetworkAdapterInterface,
    eventBus: EventBusInterface
  ): UploadService {
    return new UploadService(
      chunkManager,
      hashCalculator,
      uploadScheduler,
      sessionManager,
      networkAdapter,
      eventBus
    )
  }

  static createWithRetry(
    chunkManager: ChunkManagerInterface,
    hashCalculator: HashCalculatorInterface,
    uploadScheduler: UploadSchedulerInterface,
    sessionManager: SessionManagerInterface,
    networkAdapter: NetworkAdapterInterface,
    eventBus: EventBusInterface,
    retryConfig?: Partial<RetryConfig>
  ): UploadService {
    const uploadService = new UploadService(
      chunkManager,
      hashCalculator,
      uploadScheduler,
      sessionManager,
      networkAdapter,
      eventBus
    )

    if (retryConfig) {
      uploadService.configureRetry(retryConfig)
    }

    return uploadService
  }
}
