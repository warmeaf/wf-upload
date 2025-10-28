/**
 * WfUpload - 大文件上传解决方案
 * 基于文件分片的大文件上传，支持断点续传、秒传、进度监控等功能
 */

// 导入核心服务
import { UploadService, UploadServiceOptions, UploadProgress, UploadResult, UploadError, UploadStatus } from './application/UploadService'
import { ProgressService } from './application/ProgressService'
import { ErrorService } from './application/ErrorService'

// 导入领域服务
import { FileProcessor, FileProcessorOptions } from './domain/FileProcessor'
import { ChunkManager } from './domain/ChunkManager'
import { HashCalculator } from './domain/HashCalculator'
import { StateManager } from './domain/StateManager'
import { UploadScheduler, UploadSchedulerFactory } from './domain/UploadScheduler'
import { SessionManager } from './domain/SessionManager'

// 导入基础设施
import { EventBus } from './infrastructure/EventBus'
import { NetworkAdapter } from './infrastructure/NetworkAdapter'
import { LocalStorageAdapter } from './infrastructure/StorageAdapter';
import { RepositoryFactory } from './data-access/repositories';
import { TimerService } from './infrastructure/TimerService'
import { WorkerAdapter } from './infrastructure/WorkerAdapter'

// 导入数据实体
import { UploadOptions, SessionStatus, ChunkStatus, FileStatus } from './data-access/entities'

/**
 * WfUpload 配置选项
 */
export interface WfUploadOptions extends UploadServiceOptions {
  // 网络配置
  baseURL?: string
  timeout?: number
  headers?: Record<string, string>
  
  // 文件处理配置
  maxFileSize?: number
  allowedTypes?: string[]
  allowedExtensions?: string[]
  
  // 上传配置
  chunkSize?: number
  concurrency?: number
  retryCount?: number
  retryDelay?: number
  
  // 功能开关
  enableSecondUpload?: boolean
  enableResume?: boolean
  enableProgress?: boolean
  enableRetry?: boolean
  autoCleanup?: boolean
  
  // 事件回调
  onProgress?: (progress: UploadProgress) => void
  onError?: (error: UploadError) => void
  onComplete?: (result: UploadResult) => void
  onStart?: (sessionId: string) => void
  onPause?: (sessionId: string) => void
  onResume?: (sessionId: string) => void
  onCancel?: (sessionId: string) => void
}

/**
 * WfUpload 主类 - 大文件上传核心API
 */
export class WfUpload {
  private uploadService: UploadService
  private progressService: ProgressService
  private errorService: ErrorService
  private eventBus: EventBus
  private options: WfUploadOptions
  private currentSessionId?: string
  private file: File

  constructor(file: File, options: WfUploadOptions = {}) {
    this.file = file
    this.options = {
      chunkSize: 2 * 1024 * 1024, // 2MB
      concurrency: 3,
      retryCount: 3,
      retryDelay: 1000,
      enableSecondUpload: true,
      enableResume: true,
      enableProgress: true,
      enableRetry: true,
      autoCleanup: true,
      ...options
    }

    // 创建基础服务
    const eventBus = new EventBus();
    const timerService = new TimerService();
    const workerAdapter = new WorkerAdapter();
    const networkAdapter = new NetworkAdapter();

    // 创建存储库
    const storageAdapter = new LocalStorageAdapter();
    const chunkRepository = RepositoryFactory.createChunkRepository(storageAdapter);
    const sessionRepository = RepositoryFactory.createSessionRepository(storageAdapter);

    // 创建核心服务
    const hashCalculator = new HashCalculator(eventBus, workerAdapter);
    const chunkManager = new ChunkManager(chunkRepository, eventBus);
    const sessionManager = new SessionManager(sessionRepository, eventBus, timerService);
    const stateManager = new StateManager(eventBus, storageAdapter);
    const fileProcessor = new FileProcessor(this.options);

    // 初始化基础设施
    this.eventBus = eventBus
    
    // 创建应用服务
    const progressService = new ProgressService(eventBus, timerService, stateManager, chunkManager, sessionManager);
    const errorService = new ErrorService(eventBus, timerService, stateManager, sessionManager);
    
    // 先初始化应用服务
    this.uploadService = new UploadService(
      fileProcessor,
      chunkManager,
      hashCalculator,
      stateManager,
      null as any, // 临时占位符，稍后设置 uploadScheduler
      sessionManager,
      networkAdapter,
      eventBus
    );

    // 创建上传调度器
    const uploadScheduler = UploadSchedulerFactory.create(
      this.uploadService,
      eventBus,
      timerService
    );

    // 设置上传调度器
    (this.uploadService as any).setUploadScheduler(uploadScheduler);

    // 保存服务引用
    this.progressService = progressService;
    this.errorService = errorService;

    // 设置事件监听
    this.setupEventListeners()
  }

  /**
   * 开始上传
   */
  async start(): Promise<string> {
    try {
      const session = await this.uploadService.startUpload(this.file, this.options)
      this.currentSessionId = session.id
      
      if (this.options.onStart) {
        this.options.onStart(session.id)
      }
      
      return session.id
    } catch (error) {
      const uploadError: UploadError = {
        sessionId: this.currentSessionId || '',
        code: 'START_FAILED',
        message: error instanceof Error ? error.message : 'Unknown error',
        retryable: true
      }
      
      if (this.options.onError) {
        this.options.onError(uploadError)
      }
      
      throw error
    }
  }

  /**
   * 暂停上传
   */
  async pause(): Promise<void> {
    if (!this.currentSessionId) {
      throw new Error('No active upload session')
    }
    
    await this.uploadService.pauseUpload(this.currentSessionId)
    
    if (this.options.onPause) {
      this.options.onPause(this.currentSessionId)
    }
  }

  /**
   * 恢复上传
   */
  async resume(): Promise<void> {
    if (!this.currentSessionId) {
      throw new Error('No active upload session')
    }
    
    await this.uploadService.resumeUpload(this.currentSessionId)
    
    if (this.options.onResume) {
      this.options.onResume(this.currentSessionId)
    }
  }

  /**
   * 取消上传
   */
  async cancel(): Promise<void> {
    if (!this.currentSessionId) {
      throw new Error('No active upload session')
    }
    
    await this.uploadService.cancelUpload(this.currentSessionId)
    
    if (this.options.onCancel) {
      this.options.onCancel(this.currentSessionId)
    }
  }

  /**
   * 重试上传
   */
  async retry(): Promise<void> {
    if (!this.currentSessionId) {
      throw new Error('No active upload session')
    }
    
    await this.uploadService.retryUpload(this.currentSessionId)
  }

  /**
   * 获取上传状态
   */
  async getStatus(): Promise<UploadStatus> {
    if (!this.currentSessionId) {
      return UploadStatus.IDLE
    }
    
    return await this.uploadService.getUploadStatus(this.currentSessionId)
  }

  /**
   * 获取上传进度
   */
  async getProgress(): Promise<UploadProgress | undefined> {
    if (!this.currentSessionId) {
      return undefined
    }
    
    return await this.uploadService.getUploadProgress(this.currentSessionId)
  }

  /**
   * 事件监听
   */
  on(event: string, callback: (...args: any[]) => void): void {
    this.eventBus.on(event, callback)
  }

  /**
   * 取消事件监听
   */
  off(event: string, callback: (...args: any[]) => void): void {
    this.eventBus.off(event, callback)
  }

  /**
   * 一次性事件监听
   */
  once(event: string, callback: (...args: any[]) => void): void {
    this.eventBus.once(event, callback)
  }

  /**
   * 销毁实例
   */
  destroy(): void {
    if (this.currentSessionId) {
      this.uploadService.cancelUpload(this.currentSessionId).catch(console.error)
    }
    this.eventBus.clear()
  }

  /**
   * 获取进度服务
   */
  getProgressService(): ProgressService {
    return this.progressService
  }

  /**
   * 获取错误服务
   */
  getErrorService(): ErrorService {
    return this.errorService
  }

  /**
   * 设置事件监听器
   */
  private setupEventListeners(): void {
    // 进度事件
    this.eventBus.on('upload:progress', (progress: UploadProgress) => {
      if (this.options.onProgress) {
        this.options.onProgress(progress)
      }
    })

    // 错误事件
    this.eventBus.on('upload:error', (error: UploadError) => {
      if (this.options.onError) {
        this.options.onError(error)
      }
    })

    // 完成事件
    this.eventBus.on('upload:completed', (result: UploadResult) => {
      if (this.options.onComplete) {
        this.options.onComplete(result)
      }
    })
  }

}

/**
 * 工厂函数 - 创建 WfUpload 实例
 */
export function createUpload(file: File, options?: WfUploadOptions): WfUpload {
  return new WfUpload(file, options)
}

/**
 * 便捷函数 - 快速上传文件
 */
export async function uploadFile(
  file: File, 
  options?: WfUploadOptions
): Promise<UploadResult> {
  const upload = new WfUpload(file, options)
  
  return new Promise((resolve, reject) => {
    upload.on('upload:completed', resolve)
    upload.on('upload:error', reject)
    upload.start().catch(reject)
  })
}

// 导出核心类型和接口
export type {
  UploadOptions,
  UploadProgress,
  UploadResult,
  UploadError,
  FileProcessorOptions
}

// 导出枚举
export {
  UploadStatus,
  SessionStatus,
  ChunkStatus,
  FileStatus
}

// 导出核心服务（供高级用户使用）
export {
  UploadService,
  ProgressService,
  ErrorService,
  FileProcessor,
  ChunkManager,
  HashCalculator,
  StateManager,
  UploadScheduler,
  SessionManager,
  EventBus,
  NetworkAdapter,
  LocalStorageAdapter,
  TimerService,
  WorkerAdapter
}

// 默认导出
export default WfUpload