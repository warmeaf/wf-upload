/**
 * 会话管理器 - 领域服务层
 * 管理上传会话的生命周期、数据管理和清理回收
 */

import { EventBusInterface } from '../infrastructure/EventBus'
import { TimerServiceInterface } from '../infrastructure/TimerService'
import { SessionRepositoryInterface } from '../data-access/repositories'
import { SessionEntity, SessionStatus, UploadOptions, ProgressInfo, EntityFactory } from '../data-access/entities'

export interface UploadSession {
  id: string
  fileId: string
  status: SessionStatus
  options: UploadOptions
  progress: ProgressInfo
  token?: string
  createdAt: number
  updatedAt: number
  expiresAt?: number
  metadata?: Record<string, any>
}

export interface SessionConfig {
  defaultExpiration: number // 默认过期时间（毫秒）
  cleanupInterval: number   // 清理间隔（毫秒）
  maxSessions: number       // 最大会话数
  enableAutoCleanup: boolean
  enablePersistence: boolean
  sessionTimeout: number    // 会话超时时间
}

export interface SessionManagerInterface {
  // 创建会话
  createSession(options?: UploadOptions): Promise<UploadSession>
  // 获取会话
  getSession(sessionId: string): Promise<UploadSession | undefined>
  // 更新会话
  updateSession(sessionId: string, updates: Partial<UploadSession>): Promise<void>
  // 销毁会话
  destroySession(sessionId: string): Promise<void>
  // 获取所有活跃会话
  getActiveSessions(): Promise<UploadSession[]>
  // 暂停会话
  pauseSession(sessionId: string): Promise<void>
  // 恢复会话
  resumeSession(sessionId: string): Promise<void>
  // 完成会话
  completeSession(sessionId: string): Promise<void>
  // 失败会话
  failSession(sessionId: string): Promise<void>
  // 清理过期会话
  cleanupExpiredSessions(): Promise<number>
  // 获取会话统计
  getSessionStats(): Promise<SessionStatistics>
  // 设置会话元数据
  setSessionMetadata(sessionId: string, metadata: Record<string, any>): Promise<void>
  // 延长会话过期时间
  extendSession(sessionId: string, extensionTime?: number): Promise<void>
  // 根据状态查找会话
  findSessionsByStatus(status: SessionStatus): Promise<UploadSession[]>
}

export interface SessionStatistics {
  totalSessions: number
  activeSessions: number
  pausedSessions: number
  completedSessions: number
  failedSessions: number
  expiredSessions: number
  averageSessionDuration: number
  totalUploadedSize: number
  successRate: number
}

export class SessionManager implements SessionManagerInterface {
  private sessionRepository: SessionRepositoryInterface
  private eventBus: EventBusInterface
  private timerService: TimerServiceInterface
  private config: SessionConfig
  private cleanupTimer?: string
  private sessionTimeouts: Map<string, string> = new Map()

  constructor(
    sessionRepository: SessionRepositoryInterface,
    eventBus: EventBusInterface,
    timerService: TimerServiceInterface,
    config?: Partial<SessionConfig>
  ) {
    this.sessionRepository = sessionRepository
    this.eventBus = eventBus
    this.timerService = timerService
    this.config = {
      defaultExpiration: 24 * 60 * 60 * 1000, // 24小时
      cleanupInterval: 5 * 60 * 1000,         // 5分钟
      maxSessions: 100,
      enableAutoCleanup: true,
      enablePersistence: true,
      sessionTimeout: 30 * 60 * 1000,         // 30分钟无活动超时
      ...config
    }

    if (this.config.enableAutoCleanup) {
      this.startAutoCleanup()
    }
  }

  async createSession(options: UploadOptions = {}): Promise<UploadSession> {
    // 检查会话数量限制
    const activeSessions = await this.getActiveSessions()
    if (activeSessions.length >= this.config.maxSessions) {
      throw new Error(`Maximum number of sessions (${this.config.maxSessions}) exceeded`)
    }

    // 生成文件ID
    const fileId = `file_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

    // 创建会话实体
    const sessionEntity = EntityFactory.createSessionEntity(fileId, options)
    
    // 设置过期时间
    const expirationTime = options.autoCleanup !== false 
      ? Date.now() + this.config.defaultExpiration 
      : undefined

    sessionEntity.expiresAt = expirationTime

    // 保存到仓库
    await this.sessionRepository.save(sessionEntity)

    // 创建会话对象
    const session: UploadSession = {
      id: sessionEntity.id,
      fileId: sessionEntity.fileId,
      status: sessionEntity.status,
      options: sessionEntity.options,
      progress: sessionEntity.progress,
      token: sessionEntity.token,
      createdAt: sessionEntity.createdAt,
      updatedAt: sessionEntity.updatedAt,
      expiresAt: sessionEntity.expiresAt
    }

    // 设置会话超时
    this.setSessionTimeout(session.id)

    // 发布事件
    this.eventBus.emit('session:created', {
      sessionId: session.id,
      fileId: session.fileId,
      options: session.options
    })

    return session
  }

  async getSession(sessionId: string): Promise<UploadSession | undefined> {
    const sessionEntity = await this.sessionRepository.findById(sessionId)
    if (!sessionEntity) {
      return undefined
    }

    // 检查会话是否过期
    if (this.isSessionExpired(sessionEntity)) {
      await this.expireSession(sessionId)
      return undefined
    }

    // 更新最后访问时间
    await this.touchSession(sessionId)

    return this.entityToSession(sessionEntity)
  }

  async updateSession(sessionId: string, updates: Partial<UploadSession>): Promise<void> {
    const sessionEntity = await this.sessionRepository.findById(sessionId)
    if (!sessionEntity) {
      throw new Error(`Session ${sessionId} not found`)
    }

    // 更新实体
    const entityUpdates: Partial<SessionEntity> = {}
    
    if (updates.status !== undefined) entityUpdates.status = updates.status
    if (updates.options !== undefined) entityUpdates.options = updates.options
    if (updates.progress !== undefined) entityUpdates.progress = updates.progress
    if (updates.token !== undefined) entityUpdates.token = updates.token
    if (updates.expiresAt !== undefined) entityUpdates.expiresAt = updates.expiresAt

    await this.sessionRepository.update(sessionId, entityUpdates)

    // 重置超时
    this.setSessionTimeout(sessionId)

    // 发布事件
    this.eventBus.emit('session:updated', {
      sessionId,
      updates
    })
  }

  async failSession(sessionId: string): Promise<void> {
    const session = await this.getSession(sessionId)
    if (!session) {
      throw new Error(`Session ${sessionId} not found`)
    }

    // 清除超时定时器
    this.clearSessionTimeout(sessionId)

    // 更新状态
    await this.sessionRepository.updateStatus(sessionId, SessionStatus.FAILED)

    // 计算会话持续时间
    const duration = Date.now() - session.createdAt

    this.eventBus.emit('session:failed', {
      sessionId,
      failedAt: Date.now(),
      duration,
      uploadedSize: session.progress.uploadedSize
    })
  }

  async destroySession(sessionId: string): Promise<void> {
    const session = await this.getSession(sessionId)
    if (!session) {
      return
    }

    // 清除超时定时器
    this.clearSessionTimeout(sessionId)

    // 删除会话
    await this.sessionRepository.delete(sessionId)

    // 发布事件
    this.eventBus.emit('session:destroyed', {
      sessionId,
      status: session.status,
      duration: Date.now() - session.createdAt
    })
  }

  async getActiveSessions(): Promise<UploadSession[]> {
    const sessionEntities = await this.sessionRepository.getActiveSessions()
    const sessions: UploadSession[] = []

    for (const entity of sessionEntities) {
      if (!this.isSessionExpired(entity)) {
        sessions.push(this.entityToSession(entity))
      }
    }

    return sessions
  }

  async pauseSession(sessionId: string): Promise<void> {
    const session = await this.getSession(sessionId)
    if (!session) {
      throw new Error(`Session ${sessionId} not found`)
    }

    if (session.status !== SessionStatus.ACTIVE) {
      throw new Error(`Cannot pause session in ${session.status} status`)
    }

    await this.sessionRepository.updateStatus(sessionId, SessionStatus.PAUSED)

    this.eventBus.emit('session:paused', {
      sessionId,
      pausedAt: Date.now()
    })
  }

  async resumeSession(sessionId: string): Promise<void> {
    const session = await this.getSession(sessionId)
    if (!session) {
      throw new Error(`Session ${sessionId} not found`)
    }

    if (session.status !== SessionStatus.PAUSED) {
      throw new Error(`Cannot resume session in ${session.status} status`)
    }

    await this.sessionRepository.updateStatus(sessionId, SessionStatus.ACTIVE)

    // 重置超时
    this.setSessionTimeout(sessionId)

    this.eventBus.emit('session:resumed', {
      sessionId,
      resumedAt: Date.now()
    })
  }

  async completeSession(sessionId: string): Promise<void> {
    const session = await this.getSession(sessionId)
    if (!session) {
      throw new Error(`Session ${sessionId} not found`)
    }

    // 清除超时定时器
    this.clearSessionTimeout(sessionId)

    // 更新状态
    await this.sessionRepository.updateStatus(sessionId, SessionStatus.COMPLETED)

    // 计算会话持续时间
    const duration = Date.now() - session.createdAt

    this.eventBus.emit('session:completed', {
      sessionId,
      completedAt: Date.now(),
      duration,
      uploadedSize: session.progress.uploadedSize
    })
  }

  async cleanupExpiredSessions(): Promise<number> {
    const allSessions = await this.sessionRepository.findAll()
    let cleanedCount = 0

    for (const session of allSessions) {
      if (this.isSessionExpired(session)) {
        await this.expireSession(session.id)
        cleanedCount++
      }
    }

    if (cleanedCount > 0) {
      this.eventBus.emit('session:cleanup:completed', {
        cleanedCount,
        timestamp: Date.now()
      })
    }

    return cleanedCount
  }

  async getSessionStats(): Promise<SessionStatistics> {
    const allSessions = await this.sessionRepository.findAll()
    
    const totalSessions = allSessions.length
    const activeSessions = allSessions.filter(s => s.status === SessionStatus.ACTIVE).length
    const pausedSessions = allSessions.filter(s => s.status === SessionStatus.PAUSED).length
    const completedSessions = allSessions.filter(s => s.status === SessionStatus.COMPLETED).length
    const failedSessions = allSessions.filter(s => s.status === SessionStatus.FAILED).length
    const expiredSessions = allSessions.filter(s => s.status === SessionStatus.EXPIRED).length

    // 计算平均会话持续时间
    const completedSessionsWithDuration = allSessions.filter(s => 
      s.status === SessionStatus.COMPLETED && s.updatedAt > s.createdAt
    )
    const averageSessionDuration = completedSessionsWithDuration.length > 0
      ? completedSessionsWithDuration.reduce((sum, s) => sum + (s.updatedAt - s.createdAt), 0) / completedSessionsWithDuration.length
      : 0

    // 计算总上传大小
    const totalUploadedSize = allSessions.reduce((sum, s) => sum + s.progress.uploadedSize, 0)

    // 计算成功率
    const finishedSessions = completedSessions + failedSessions
    const successRate = finishedSessions > 0 ? (completedSessions / finishedSessions) * 100 : 0

    return {
      totalSessions,
      activeSessions,
      pausedSessions,
      completedSessions,
      failedSessions,
      expiredSessions,
      averageSessionDuration,
      totalUploadedSize,
      successRate
    }
  }

  async setSessionMetadata(sessionId: string, metadata: Record<string, any>): Promise<void> {
    const session = await this.getSession(sessionId)
    if (!session) {
      throw new Error(`Session ${sessionId} not found`)
    }

    await this.updateSession(sessionId, { metadata })
  }

  async extendSession(sessionId: string, extensionTime?: number): Promise<void> {
    const session = await this.getSession(sessionId)
    if (!session) {
      throw new Error(`Session ${sessionId} not found`)
    }

    const extension = extensionTime || this.config.defaultExpiration
    const newExpirationTime = (session.expiresAt || Date.now()) + extension

    await this.updateSession(sessionId, { expiresAt: newExpirationTime })

    this.eventBus.emit('session:extended', {
      sessionId,
      extensionTime: extension,
      newExpirationTime
    })
  }

  // 批量操作
  async batchUpdateSessions(sessionIds: string[], updates: Partial<UploadSession>): Promise<void> {
    const promises = sessionIds.map(id => this.updateSession(id, updates))
    await Promise.all(promises)

    this.eventBus.emit('session:batch:updated', {
      sessionIds,
      updates,
      count: sessionIds.length
    })
  }

  async batchDestroySessions(sessionIds: string[]): Promise<void> {
    const promises = sessionIds.map(id => this.destroySession(id))
    await Promise.all(promises)

    this.eventBus.emit('session:batch:destroyed', {
      sessionIds,
      count: sessionIds.length
    })
  }

  // 根据条件查找会话
  async findSessionsByStatus(status: SessionStatus): Promise<UploadSession[]> {
    const sessionEntities = await this.sessionRepository.findByStatus(status)
    return sessionEntities
      .filter(entity => !this.isSessionExpired(entity))
      .map(entity => this.entityToSession(entity))
  }

  // 获取会话历史记录
  async getSessionHistory(limit: number = 50): Promise<UploadSession[]> {
    const allSessions = await this.sessionRepository.findAll()
    
    return allSessions
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit)
      .map(entity => this.entityToSession(entity))
  }

  private entityToSession(entity: SessionEntity): UploadSession {
    return {
      id: entity.id,
      fileId: entity.fileId,
      status: entity.status,
      options: entity.options,
      progress: entity.progress,
      token: entity.token,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
      expiresAt: entity.expiresAt
    }
  }

  private isSessionExpired(session: SessionEntity): boolean {
    if (!session.expiresAt) {
      return false
    }
    return Date.now() > session.expiresAt
  }

  private async expireSession(sessionId: string): Promise<void> {
    await this.sessionRepository.updateStatus(sessionId, SessionStatus.EXPIRED)
    this.clearSessionTimeout(sessionId)

    this.eventBus.emit('session:expired', {
      sessionId,
      expiredAt: Date.now()
    })
  }

  private async touchSession(sessionId: string): Promise<void> {
    // 更新最后访问时间，重置超时
    await this.sessionRepository.update(sessionId, { updatedAt: Date.now() })
    this.setSessionTimeout(sessionId)
  }

  private setSessionTimeout(sessionId: string): void {
    // 清除现有超时
    this.clearSessionTimeout(sessionId)

    // 设置新的超时
    const timeoutId = this.timerService.setTimeout(() => {
      this.handleSessionTimeout(sessionId)
    }, this.config.sessionTimeout)

    this.sessionTimeouts.set(sessionId, timeoutId)
  }

  private clearSessionTimeout(sessionId: string): void {
    const timeoutId = this.sessionTimeouts.get(sessionId)
    if (timeoutId) {
      this.timerService.clearTimer(timeoutId)
      this.sessionTimeouts.delete(sessionId)
    }
  }

  private async handleSessionTimeout(sessionId: string): Promise<void> {
    const session = await this.getSession(sessionId)
    if (session && session.status === SessionStatus.ACTIVE) {
      // 将活跃会话标记为暂停
      await this.pauseSession(sessionId)
      
      this.eventBus.emit('session:timeout', {
        sessionId,
        timeoutAt: Date.now()
      })
    }
  }

  private startAutoCleanup(): void {
    this.cleanupTimer = this.timerService.setInterval(() => {
      this.cleanupExpiredSessions().catch(error => {
        console.error('Auto cleanup failed:', error)
      })
    }, this.config.cleanupInterval)
  }

  // 清理资源
  dispose(): void {
    if (this.cleanupTimer) {
      this.timerService.clearTimer(this.cleanupTimer)
    }

    // 清除所有会话超时
    this.sessionTimeouts.forEach(timeoutId => {
      this.timerService.clearTimer(timeoutId)
    })
    this.sessionTimeouts.clear()
  }
}

/**
 * 会话管理器工厂
 */
export class SessionManagerFactory {
  static create(
    sessionRepository: SessionRepositoryInterface,
    eventBus: EventBusInterface,
    timerService: TimerServiceInterface,
    config?: Partial<SessionConfig>
  ): SessionManager {
    return new SessionManager(sessionRepository, eventBus, timerService, config)
  }

  static createWithAutoCleanup(
    sessionRepository: SessionRepositoryInterface,
    eventBus: EventBusInterface,
    timerService: TimerServiceInterface
  ): SessionManager {
    return new SessionManager(sessionRepository, eventBus, timerService, {
      enableAutoCleanup: true,
      cleanupInterval: 2 * 60 * 1000, // 2分钟清理一次
      defaultExpiration: 12 * 60 * 60 * 1000 // 12小时过期
    })
  }

  static createLongLived(
    sessionRepository: SessionRepositoryInterface,
    eventBus: EventBusInterface,
    timerService: TimerServiceInterface
  ): SessionManager {
    return new SessionManager(sessionRepository, eventBus, timerService, {
      defaultExpiration: 7 * 24 * 60 * 60 * 1000, // 7天过期
      sessionTimeout: 2 * 60 * 60 * 1000,         // 2小时超时
      maxSessions: 200
    })
  }
}