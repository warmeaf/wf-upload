/**
 * 分片管理器 - 领域服务层
 * 负责分片创建、状态跟踪和调度优化
 */

import { EventBusInterface } from '../infrastructure/EventBus'
import { ChunkRepositoryInterface } from '../data-access/repositories'
import { ChunkEntity, ChunkStatus, EntityFactory } from '../data-access/entities'

export interface ChunkInfo {
  id: string
  index: number
  start: number
  end: number
  size: number
  hash: string
  status: ChunkStatus
  retryCount: number
  progress: number
  speed: number
  estimatedTime: number
}

export interface ChunkCreationOptions {
  chunkSize: number
  enableHash: boolean
  hashAlgorithm: 'md5' | 'sha1' | 'sha256'
  enableCompression: boolean
  compressionLevel: number
}

export interface ChunkProgress {
  chunkId: string
  uploadedBytes: number
  totalBytes: number
  percentage: number
  speed: number
  remainingTime: number
}

export interface ChunkManagerInterface {
  // 创建分片
  createChunks(file: File, sessionId: string, options?: Partial<ChunkCreationOptions>): Promise<ChunkEntity[]>
  // 获取分片信息
  getChunkInfo(chunkId: string): Promise<ChunkInfo | undefined>
  // 获取会话的所有分片
  getSessionChunks(sessionId: string): Promise<ChunkEntity[]>
  // 标记分片完成
  markChunkCompleted(chunkId: string, uploadedAt?: number): Promise<void>
  // 标记分片失败
  markChunkFailed(chunkId: string, error: string): Promise<void>
  // 重置分片状态
  resetChunkStatus(chunkId: string): Promise<void>
  // 获取待上传分片
  getPendingChunks(sessionId: string): Promise<ChunkEntity[]>
  // 获取失败的分片
  getFailedChunks(sessionId: string): Promise<ChunkEntity[]>
  // 更新分片进度
  updateChunkProgress(chunkId: string, progress: Partial<ChunkProgress>): Promise<void>
  // 获取上传统计
  getUploadStats(sessionId: string): Promise<UploadStatistics>
  // 清理分片数据
  cleanupChunks(sessionId: string): Promise<void>
  // 批量重置分片状态
  batchResetChunks(chunkIds: string[]): Promise<void>
  // 获取可重试的分片
  getRetryableChunks(sessionId: string, maxRetries?: number): Promise<ChunkEntity[]>
  // 获取分片的二进制数据
  getChunkBlob(file: File, chunkId: string): Promise<Blob>
}

export interface UploadStatistics {
  totalChunks: number
  completedChunks: number
  failedChunks: number
  pendingChunks: number
  uploadingChunks: number
  totalSize: number
  uploadedSize: number
  progress: number
  averageSpeed: number
  estimatedTime: number
}

export class ChunkManager implements ChunkManagerInterface {
  private chunkRepository: ChunkRepositoryInterface
  private eventBus: EventBusInterface
  private chunkProgress: Map<string, ChunkProgress> = new Map()
  private defaultOptions: ChunkCreationOptions = {
    chunkSize: 5 * 1024 * 1024, // 5MB
    enableHash: true,
    hashAlgorithm: 'md5',
    enableCompression: false,
    compressionLevel: 6
  }

  constructor(
    chunkRepository: ChunkRepositoryInterface,
    eventBus: EventBusInterface
  ) {
    this.chunkRepository = chunkRepository
    this.eventBus = eventBus
  }

  async createChunks(
    file: File,
    sessionId: string,
    options?: Partial<ChunkCreationOptions>
  ): Promise<ChunkEntity[]> {
    const finalOptions = { ...this.defaultOptions, ...options }
    const chunks: ChunkEntity[] = []
    const chunkSize = finalOptions.chunkSize
    const totalChunks = Math.ceil(file.size / chunkSize)

    this.eventBus.emit('chunk:creation:started', {
      sessionId,
      totalChunks,
      fileSize: file.size
    })

    // 快速创建所有分片实体，不计算hash（为了立即开始上传）
    for (let index = 0; index < totalChunks; index++) {
      const start = index * chunkSize
      const end = Math.min(start + chunkSize, file.size)
      
      // 使用临时hash，后续可以异步计算真实hash
      const tempHash = finalOptions.enableHash 
        ? `temp_${sessionId}_${index}_${Date.now()}`
        : `chunk_${sessionId}_${index}_${Date.now()}`

      const chunkEntity = EntityFactory.createChunkEntity(
        sessionId,
        `file_${sessionId}`,
        index,
        start,
        end,
        tempHash
      )

      chunks.push(chunkEntity)
      await this.chunkRepository.save(chunkEntity)

      // 发布分片创建事件
      this.eventBus.emit('chunk:created', {
        chunkId: chunkEntity.id,
        index,
        progress: ((index + 1) / totalChunks) * 100
      })
    }

    // 如果启用了hash计算，异步计算真实hash
    if (finalOptions.enableHash) {
      this.calculateChunkHashesAsync(file, chunks, finalOptions.hashAlgorithm)
    }

    this.eventBus.emit('chunk:creation:completed', {
      sessionId,
      totalChunks: chunks.length,
      chunks: chunks.map(c => c.id),
      message: 'Chunks created with temporary hashes, real hashes calculating in background'
    })

    return chunks
  }

  /**
   * 异步计算分片hash，不阻塞上传流程
   */
  private async calculateChunkHashesAsync(
    file: File, 
    chunks: ChunkEntity[], 
    algorithm: 'md5' | 'sha1' | 'sha256'
  ): Promise<void> {
    try {
      // 并行计算所有分片的hash
      const hashPromises = chunks.map(async (chunk) => {
        const chunkBlob = file.slice(chunk.start, chunk.end)
        const hash = await this.calculateChunkHash(chunkBlob, algorithm)
        
        // 更新分片的真实hash
        await this.chunkRepository.update(chunk.id, { hash })
        
        this.eventBus.emit('chunk:hash:calculated', {
          chunkId: chunk.id,
          index: chunk.index,
          hash,
          sessionId: chunk.sessionId
        })
        
        return { chunkId: chunk.id, hash }
      })

      // 等待所有hash计算完成
      const results = await Promise.all(hashPromises)
      
      this.eventBus.emit('chunk:hash:all:completed', {
        sessionId: chunks[0]?.sessionId,
        results,
        totalChunks: chunks.length
      })

    } catch (error) {
      this.eventBus.emit('chunk:hash:failed', {
        sessionId: chunks[0]?.sessionId,
        error: error instanceof Error ? error.message : 'Chunk hash calculation failed'
      })
      // hash计算失败不影响上传继续进行
    }
  }

  async getChunkInfo(chunkId: string): Promise<ChunkInfo | undefined> {
    const chunk = await this.chunkRepository.findById(chunkId)
    if (!chunk) return undefined

    const progress = this.chunkProgress.get(chunkId)
    
    return {
      id: chunk.id,
      index: chunk.index,
      start: chunk.start,
      end: chunk.end,
      size: chunk.size,
      hash: chunk.hash,
      status: chunk.status,
      retryCount: chunk.retryCount,
      progress: progress?.percentage || 0,
      speed: progress?.speed || 0,
      estimatedTime: progress?.remainingTime || 0
    }
  }

  async getSessionChunks(sessionId: string): Promise<ChunkEntity[]> {
    return await this.chunkRepository.findBySessionId(sessionId)
  }

  async markChunkCompleted(chunkId: string, uploadedAt?: number): Promise<void> {
    const chunk = await this.chunkRepository.findById(chunkId)
    if (!chunk) {
      throw new Error(`Chunk ${chunkId} not found`)
    }

    await this.chunkRepository.update(chunkId, {
      status: ChunkStatus.COMPLETED,
      uploadedAt: uploadedAt || Date.now()
    })

    // 更新进度为100%
    this.chunkProgress.set(chunkId, {
      chunkId,
      uploadedBytes: chunk.size,
      totalBytes: chunk.size,
      percentage: 100,
      speed: 0,
      remainingTime: 0
    })

    this.eventBus.emit('chunk:completed', {
      chunkId,
      sessionId: chunk.sessionId,
      index: chunk.index,
      size: chunk.size
    })
  }

  async markChunkFailed(chunkId: string, error: string): Promise<void> {
    const chunk = await this.chunkRepository.findById(chunkId)
    if (!chunk) {
      throw new Error(`Chunk ${chunkId} not found`)
    }

    await this.chunkRepository.update(chunkId, {
      status: ChunkStatus.FAILED,
      errorMessage: error,
      retryCount: chunk.retryCount + 1
    })

    this.eventBus.emit('chunk:failed', {
      chunkId,
      sessionId: chunk.sessionId,
      index: chunk.index,
      error,
      retryCount: chunk.retryCount + 1
    })
  }

  async resetChunkStatus(chunkId: string): Promise<void> {
    await this.chunkRepository.update(chunkId, {
      status: ChunkStatus.PENDING,
      errorMessage: undefined
    })

    // 清除进度信息
    this.chunkProgress.delete(chunkId)

    this.eventBus.emit('chunk:reset', { chunkId })
  }

  async getPendingChunks(sessionId: string): Promise<ChunkEntity[]> {
    return await this.chunkRepository.getPendingChunks(sessionId)
  }

  async getFailedChunks(sessionId: string): Promise<ChunkEntity[]> {
    const chunks = await this.chunkRepository.findBySessionId(sessionId)
    return chunks.filter(chunk => chunk.status === ChunkStatus.FAILED)
  }

  async updateChunkProgress(chunkId: string, progress: Partial<ChunkProgress>): Promise<void> {
    const existingProgress = this.chunkProgress.get(chunkId)
    const updatedProgress = {
      chunkId,
      uploadedBytes: 0,
      totalBytes: 0,
      percentage: 0,
      speed: 0,
      remainingTime: 0,
      ...existingProgress,
      ...progress
    }

    this.chunkProgress.set(chunkId, updatedProgress)

    // 更新分片状态为上传中
    const chunk = await this.chunkRepository.findById(chunkId)
    if (chunk && chunk.status === ChunkStatus.PENDING) {
      await this.chunkRepository.updateStatus(chunkId, ChunkStatus.UPLOADING)
    }

    this.eventBus.emit('chunk:progress', updatedProgress)
  }

  async getUploadStats(sessionId: string): Promise<UploadStatistics> {
    const chunks = await this.chunkRepository.findBySessionId(sessionId)
    
    const totalChunks = chunks.length
    const completedChunks = chunks.filter(c => c.status === ChunkStatus.COMPLETED).length
    const failedChunks = chunks.filter(c => c.status === ChunkStatus.FAILED).length
    const pendingChunks = chunks.filter(c => c.status === ChunkStatus.PENDING).length
    const uploadingChunks = chunks.filter(c => c.status === ChunkStatus.UPLOADING).length

    const totalSize = chunks.reduce((sum, chunk) => sum + chunk.size, 0)
    const uploadedSize = chunks
      .filter(c => c.status === ChunkStatus.COMPLETED)
      .reduce((sum, chunk) => sum + chunk.size, 0)

    const progress = totalSize > 0 ? (uploadedSize / totalSize) * 100 : 0

    // 计算平均速度
    const activeProgresses = Array.from(this.chunkProgress.values())
      .filter(p => p.speed > 0)
    const averageSpeed = activeProgresses.length > 0
      ? activeProgresses.reduce((sum, p) => sum + p.speed, 0) / activeProgresses.length
      : 0

    // 估算剩余时间
    const remainingSize = totalSize - uploadedSize
    const estimatedTime = averageSpeed > 0 ? remainingSize / averageSpeed : 0

    return {
      totalChunks,
      completedChunks,
      failedChunks,
      pendingChunks,
      uploadingChunks,
      totalSize,
      uploadedSize,
      progress,
      averageSpeed,
      estimatedTime
    }
  }

  async cleanupChunks(sessionId: string): Promise<void> {
    const chunks = await this.chunkRepository.findBySessionId(sessionId)
    
    for (const chunk of chunks) {
      await this.chunkRepository.delete(chunk.id)
      this.chunkProgress.delete(chunk.id)
    }

    this.eventBus.emit('chunk:cleanup:completed', {
      sessionId,
      cleanedCount: chunks.length
    })
  }

  // 批量重置分片状态
  async batchResetChunks(chunkIds: string[]): Promise<void> {
    await this.chunkRepository.batchUpdateStatus(chunkIds, ChunkStatus.PENDING)
    
    chunkIds.forEach(chunkId => {
      this.chunkProgress.delete(chunkId)
    })

    this.eventBus.emit('chunk:batch:reset', { chunkIds })
  }

  // 获取可重试的分片
  async getRetryableChunks(sessionId: string, maxRetries: number = 3): Promise<ChunkEntity[]> {
    const failedChunks = await this.getFailedChunks(sessionId)
    return failedChunks.filter(chunk => chunk.retryCount < maxRetries)
  }

  // 获取分片的二进制数据
  async getChunkBlob(file: File, chunkId: string): Promise<Blob> {
    const chunk = await this.chunkRepository.findById(chunkId)
    if (!chunk) {
      throw new Error(`Chunk ${chunkId} not found`)
    }

    return file.slice(chunk.start, chunk.end)
  }

  // 验证分片完整性
  async verifyChunkIntegrity(file: File, chunkId: string): Promise<boolean> {
    const chunk = await this.chunkRepository.findById(chunkId)
    if (!chunk) return false

    const chunkBlob = await this.getChunkBlob(file, chunkId)
    const calculatedHash = await this.calculateChunkHash(chunkBlob, 'md5')
    
    return calculatedHash === chunk.hash
  }

  // 获取分片上传优先级
  getChunkPriority(chunk: ChunkEntity): number {
    // 基础优先级：按索引顺序
    let priority = 1000 - chunk.index

    // 失败次数越多，优先级越低
    priority -= chunk.retryCount * 100

    // 如果是关键分片（开头或结尾），提高优先级
    if (chunk.index === 0 || chunk.index < 5) {
      priority += 500
    }

    return Math.max(0, priority)
  }

  // 获取推荐的并发数
  getRecommendedConcurrency(sessionId: string): Promise<number> {
    return new Promise(async (resolve) => {
      const chunks = await this.chunkRepository.findBySessionId(sessionId)
      const totalSize = chunks.reduce((sum, chunk) => sum + chunk.size, 0)
      
      // 根据文件大小和网络状况推荐并发数
      if (totalSize < 50 * 1024 * 1024) { // < 50MB
        resolve(2)
      } else if (totalSize < 500 * 1024 * 1024) { // < 500MB
        resolve(3)
      } else if (totalSize < 2 * 1024 * 1024 * 1024) { // < 2GB
        resolve(4)
      } else {
        resolve(6)
      }
    })
  }

  private async calculateChunkHash(blob: Blob, algorithm: string): Promise<string> {
    const buffer = await blob.arrayBuffer()
    
    let hashAlgorithm: string
    switch (algorithm) {
      case 'sha1':
        hashAlgorithm = 'SHA-1'
        break
      case 'sha256':
        hashAlgorithm = 'SHA-256'
        break
      case 'md5':
      default:
        // 浏览器不支持MD5，使用SHA-256代替
        hashAlgorithm = 'SHA-256'
        break
    }

    const hashBuffer = await crypto.subtle.digest(hashAlgorithm, buffer)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
  }
}

/**
 * 分片管理器工厂
 */
export class ChunkManagerFactory {
  static create(
    chunkRepository: ChunkRepositoryInterface,
    eventBus: EventBusInterface,
    _options?: Partial<ChunkCreationOptions>
  ): ChunkManager {
    const manager = new ChunkManager(chunkRepository, eventBus)
    return manager
  }

  static createWithCustomOptions(
    chunkRepository: ChunkRepositoryInterface,
    eventBus: EventBusInterface,
    _customOptions: ChunkCreationOptions
  ): ChunkManager {
    const manager = new ChunkManager(chunkRepository, eventBus)
    // 可以在这里设置自定义选项
    return manager
  }
}