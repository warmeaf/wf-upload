/**
 * Repository接口和实现 - 数据访问层
 * 提供数据持久化的抽象接口
 */

import { StorageAdapterInterface } from '../infrastructure/StorageAdapter'
import {
  ChunkEntity,
  FileEntity,
  SessionEntity,
  ChunkStatus,
  FileStatus,
  SessionStatus,
  UploadStats
} from './entities'

/**
 * 基础Repository接口
 */
export interface BaseRepository<T> {
  save(entity: T): Promise<void>
  findById(id: string): Promise<T | undefined>
  findAll(): Promise<T[]>
  update(id: string, updates: Partial<T>): Promise<void>
  delete(id: string): Promise<void>
  exists(id: string): Promise<boolean>
  count(): Promise<number>
  clear(): Promise<void>
}

/**
 * 分片Repository接口
 */
export interface ChunkRepositoryInterface extends BaseRepository<ChunkEntity> {
  // 根据会话ID获取分片
  findBySessionId(sessionId: string): Promise<ChunkEntity[]>
  // 根据文件ID获取分片
  findByFileId(fileId: string): Promise<ChunkEntity[]>
  // 根据状态获取分片
  findByStatus(status: ChunkStatus): Promise<ChunkEntity[]>
  // 更新分片状态
  updateStatus(id: string, status: ChunkStatus): Promise<void>
  // 获取待上传的分片
  getPendingChunks(sessionId: string): Promise<ChunkEntity[]>
  // 获取已完成的分片
  getCompletedChunks(sessionId: string): Promise<ChunkEntity[]>
  // 批量更新分片状态
  batchUpdateStatus(ids: string[], status: ChunkStatus): Promise<void>
}

/**
 * 文件Repository接口
 */
export interface FileRepositoryInterface extends BaseRepository<FileEntity> {
  // 根据会话ID获取文件
  findBySessionId(sessionId: string): Promise<FileEntity | undefined>
  // 根据状态获取文件
  findByStatus(status: FileStatus): Promise<FileEntity[]>
  // 更新文件状态
  updateStatus(id: string, status: FileStatus): Promise<void>
  // 更新上传进度
  updateProgress(id: string, uploadedSize: number, completedChunks: number): Promise<void>
  // 根据Hash查找文件
  findByHash(hash: string): Promise<FileEntity[]>
}

/**
 * 会话Repository接口
 */
export interface SessionRepositoryInterface extends BaseRepository<SessionEntity> {
  // 获取活跃会话
  getActiveSessions(): Promise<SessionEntity[]>
  // 根据状态获取会话
  findByStatus(status: SessionStatus): Promise<SessionEntity[]>
  // 更新会话状态
  updateStatus(id: string, status: SessionStatus): Promise<void>
  // 更新进度信息
  updateProgress(id: string, progress: Partial<SessionEntity['progress']>): Promise<void>
  // 清理过期会话
  cleanupExpiredSessions(): Promise<number>
  // 获取统计信息
  getStats(): Promise<UploadStats>
}

/**
 * 基础Repository实现
 */
export abstract class BaseRepositoryImpl<T extends { id: string; updatedAt: number }> 
  implements BaseRepository<T> {
  
  protected storage: StorageAdapterInterface
  protected keyPrefix: string

  constructor(storage: StorageAdapterInterface, keyPrefix: string) {
    this.storage = storage
    this.keyPrefix = keyPrefix
  }

  async save(entity: T): Promise<void> {
    entity.updatedAt = Date.now()
    await this.storage.store(this.getKey(entity.id), entity)
  }

  async findById(id: string): Promise<T | undefined> {
    return await this.storage.retrieve<T>(this.getKey(id))
  }

  async findAll(): Promise<T[]> {
    const keys = await this.storage.keys()
    const entityKeys = keys.filter(key => key.startsWith(this.keyPrefix))
    const entities: T[] = []

    for (const key of entityKeys) {
      const entity = await this.storage.retrieve<T>(key)
      if (entity) {
        entities.push(entity)
      }
    }

    return entities
  }

  async update(id: string, updates: Partial<T>): Promise<void> {
    const entity = await this.findById(id)
    if (!entity) {
      throw new Error(`Entity with id "${id}" not found`)
    }

    const updatedEntity = { ...entity, ...updates, updatedAt: Date.now() }
    await this.save(updatedEntity)
  }

  async delete(id: string): Promise<void> {
    await this.storage.remove(this.getKey(id))
  }

  async exists(id: string): Promise<boolean> {
    return await this.storage.exists(this.getKey(id))
  }

  async count(): Promise<number> {
    const entities = await this.findAll()
    return entities.length
  }

  async clear(): Promise<void> {
    const keys = await this.storage.keys()
    const entityKeys = keys.filter(key => key.startsWith(this.keyPrefix))
    
    for (const key of entityKeys) {
      await this.storage.remove(key)
    }
  }

  protected getKey(id: string): string {
    return `${this.keyPrefix}${id}`
  }

  protected async findByCondition(predicate: (entity: T) => boolean): Promise<T[]> {
    const entities = await this.findAll()
    return entities.filter(predicate)
  }
}

/**
 * 分片Repository实现
 */
export class ChunkRepository extends BaseRepositoryImpl<ChunkEntity> 
  implements ChunkRepositoryInterface {
  
  constructor(storage: StorageAdapterInterface) {
    super(storage, 'chunk:')
  }

  async findBySessionId(sessionId: string): Promise<ChunkEntity[]> {
    return this.findByCondition(chunk => chunk.sessionId === sessionId)
  }

  async findByFileId(fileId: string): Promise<ChunkEntity[]> {
    return this.findByCondition(chunk => chunk.fileId === fileId)
  }

  async findByStatus(status: ChunkStatus): Promise<ChunkEntity[]> {
    return this.findByCondition(chunk => chunk.status === status)
  }

  async updateStatus(id: string, status: ChunkStatus): Promise<void> {
    await this.update(id, { status })
  }

  async getPendingChunks(sessionId: string): Promise<ChunkEntity[]> {
    const chunks = await this.findBySessionId(sessionId)
    return chunks.filter(chunk => chunk.status === ChunkStatus.PENDING)
  }

  async getCompletedChunks(sessionId: string): Promise<ChunkEntity[]> {
    const chunks = await this.findBySessionId(sessionId)
    return chunks.filter(chunk => chunk.status === ChunkStatus.COMPLETED)
  }

  async batchUpdateStatus(ids: string[], status: ChunkStatus): Promise<void> {
    const promises = ids.map(id => this.updateStatus(id, status))
    await Promise.all(promises)
  }
}

/**
 * 文件Repository实现
 */
export class FileRepository extends BaseRepositoryImpl<FileEntity> 
  implements FileRepositoryInterface {
  
  constructor(storage: StorageAdapterInterface) {
    super(storage, 'file:')
  }

  async findBySessionId(sessionId: string): Promise<FileEntity | undefined> {
    const files = await this.findByCondition(file => file.sessionId === sessionId)
    return files[0]
  }

  async findByStatus(status: FileStatus): Promise<FileEntity[]> {
    return this.findByCondition(file => file.status === status)
  }

  async updateStatus(id: string, status: FileStatus): Promise<void> {
    await this.update(id, { status })
  }

  async updateProgress(id: string, uploadedSize: number, completedChunks: number): Promise<void> {
    await this.update(id, { uploadedSize, completedChunks })
  }

  async findByHash(hash: string): Promise<FileEntity[]> {
    return this.findByCondition(file => file.hash === hash)
  }
}

/**
 * 会话Repository实现
 */
export class SessionRepository extends BaseRepositoryImpl<SessionEntity> 
  implements SessionRepositoryInterface {
  
  constructor(storage: StorageAdapterInterface) {
    super(storage, 'session:')
  }

  async getActiveSessions(): Promise<SessionEntity[]> {
    return this.findByCondition(session => 
      session.status === SessionStatus.ACTIVE || 
      session.status === SessionStatus.CREATED ||
      session.status === SessionStatus.PAUSED
    )
  }

  async findByStatus(status: SessionStatus): Promise<SessionEntity[]> {
    return this.findByCondition(session => session.status === status)
  }

  async updateStatus(id: string, status: SessionStatus): Promise<void> {
    await this.update(id, { status })
  }

  async updateProgress(id: string, progress: Partial<SessionEntity['progress']>): Promise<void> {
    const session = await this.findById(id)
    if (!session) {
      throw new Error(`Session with id "${id}" not found`)
    }

    const updatedProgress = { ...session.progress, ...progress }
    await this.update(id, { progress: updatedProgress })
  }

  async cleanupExpiredSessions(): Promise<number> {
    const now = Date.now()
    const sessions = await this.findAll()
    const expiredSessions = sessions.filter(session => 
      session.expiresAt && session.expiresAt < now
    )

    for (const session of expiredSessions) {
      await this.updateStatus(session.id, SessionStatus.EXPIRED)
    }

    return expiredSessions.length
  }

  async getStats(): Promise<UploadStats> {
    const sessions = await this.findAll()
    
    const totalSessions = sessions.length
    const activeSessions = sessions.filter(s => 
      s.status === SessionStatus.ACTIVE || s.status === SessionStatus.CREATED
    ).length
    const completedSessions = sessions.filter(s => 
      s.status === SessionStatus.COMPLETED
    ).length
    const failedSessions = sessions.filter(s => 
      s.status === SessionStatus.FAILED
    ).length

    let totalSize = 0
    let uploadedSize = 0
    let totalChunks = 0
    let completedChunks = 0

    sessions.forEach(session => {
      totalSize += session.progress.totalSize
      uploadedSize += session.progress.uploadedSize
      totalChunks += session.progress.totalChunks
      completedChunks += session.progress.uploadedChunks
    })

    return {
      totalSessions,
      activeSessions,
      completedSessions,
      failedSessions,
      totalFiles: totalSessions, // 假设一个会话对应一个文件
      totalSize,
      uploadedSize,
      totalChunks,
      completedChunks,
      failedChunks: totalChunks - completedChunks
    }
  }
}

/**
 * Repository工厂
 */
export class RepositoryFactory {
  static createChunkRepository(storage: StorageAdapterInterface): ChunkRepositoryInterface {
    return new ChunkRepository(storage)
  }

  static createFileRepository(storage: StorageAdapterInterface): FileRepositoryInterface {
    return new FileRepository(storage)
  }

  static createSessionRepository(storage: StorageAdapterInterface): SessionRepositoryInterface {
    return new SessionRepository(storage)
  }

  static createAll(storage: StorageAdapterInterface) {
    return {
      chunkRepository: new ChunkRepository(storage),
      fileRepository: new FileRepository(storage),
      sessionRepository: new SessionRepository(storage)
    }
  }
}