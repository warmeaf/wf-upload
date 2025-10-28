/**
 * 进度服务 - 应用服务层
 * 管理进度订阅、通知和缓存
 */

import { EventBusInterface } from '../infrastructure/EventBus'
import { TimerServiceInterface } from '../infrastructure/TimerService'
import { StateManagerInterface } from '../domain/StateManager'
import { ChunkManagerInterface } from '../domain/ChunkManager'
import { SessionManagerInterface } from '../domain/SessionManager'

export interface ProgressInfo {
  sessionId: string
  uploadedSize: number
  totalSize: number
  uploadedChunks: number
  totalChunks: number
  percentage: number
  speed: number
  remainingTime: number
  status: string
  startTime: number
  lastUpdateTime: number
  averageSpeed: number
  peakSpeed: number
  estimatedCompletion: number
}

export interface ProgressCallback {
  (progress: ProgressInfo): void
}

export interface ProgressSubscription {
  id: string
  sessionId: string
  callback: ProgressCallback
  options: ProgressSubscriptionOptions
  createdAt: number
  lastNotified: number
}

export interface ProgressSubscriptionOptions {
  throttle?: number        // 节流间隔（毫秒）
  minProgressDelta?: number // 最小进度变化百分比
  includeSpeed?: boolean   // 是否包含速度信息
  includeETA?: boolean     // 是否包含预计完成时间
  onlyOnChange?: boolean   // 仅在进度变化时通知
}

export interface ProgressStatistics {
  totalSubscriptions: number
  activeSubscriptions: number
  totalNotifications: number
  averageNotificationRate: number
  peakNotificationRate: number
  cacheHitRate: number
}

export interface ProgressServiceInterface {
  // 订阅进度更新
  subscribe(sessionId: string, callback: ProgressCallback, options?: ProgressSubscriptionOptions): string
  // 取消订阅
  unsubscribe(sessionId: string, subscriptionId: string): void
  // 取消会话的所有订阅
  unsubscribeAll(sessionId: string): void
  // 获取当前进度
  getCurrentProgress(sessionId: string): Promise<ProgressInfo | undefined>
  // 批量获取进度
  getBatchProgress(sessionIds: string[]): Promise<Map<string, ProgressInfo>>
  // 更新进度
  updateProgress(sessionId: string, progress: Partial<ProgressInfo>): void
  // 获取进度历史
  getProgressHistory(sessionId: string, limit?: number): ProgressInfo[]
  // 获取统计信息
  getStatistics(): ProgressStatistics
  // 清理过期数据
  cleanup(): void
}

export class ProgressService implements ProgressServiceInterface {
  private eventBus: EventBusInterface
  private timerService: TimerServiceInterface
  private stateManager: StateManagerInterface
  private chunkManager: ChunkManagerInterface
  private sessionManager: SessionManagerInterface
  
  private subscriptions: Map<string, Map<string, ProgressSubscription>> = new Map()
  private progressCache: Map<string, ProgressInfo> = new Map()
  private progressHistory: Map<string, ProgressInfo[]> = new Map()
  private speedCalculator: Map<string, SpeedCalculator> = new Map()
  
  private statistics = {
    totalNotifications: 0,
    notificationsInLastMinute: 0,
    cacheHits: 0,
    cacheRequests: 0,
    lastStatsReset: Date.now()
  }

  private cleanupTimer?: string
  private statsTimer?: string

  constructor(
    eventBus: EventBusInterface,
    timerService: TimerServiceInterface,
    stateManager: StateManagerInterface,
    chunkManager: ChunkManagerInterface,
    sessionManager: SessionManagerInterface
  ) {
    this.eventBus = eventBus
    this.timerService = timerService
    this.stateManager = stateManager
    this.chunkManager = chunkManager
    this.sessionManager = sessionManager

    this.setupEventListeners()
    this.startCleanupTimer()
    this.startStatsTimer()
  }

  subscribe(
    sessionId: string, 
    callback: ProgressCallback, 
    options: ProgressSubscriptionOptions = {}
  ): string {
    const subscriptionId = this.generateSubscriptionId()
    
    const subscription: ProgressSubscription = {
      id: subscriptionId,
      sessionId,
      callback,
      options: {
        throttle: 1000,           // 默认1秒节流
        minProgressDelta: 0.1,    // 默认0.1%最小变化
        includeSpeed: true,
        includeETA: true,
        onlyOnChange: true,
        ...options
      },
      createdAt: Date.now(),
      lastNotified: 0
    }

    if (!this.subscriptions.has(sessionId)) {
      this.subscriptions.set(sessionId, new Map())
    }
    
    this.subscriptions.get(sessionId)!.set(subscriptionId, subscription)

    // 立即发送当前进度
    this.getCurrentProgress(sessionId).then(progress => {
      if (progress) {
        this.notifySubscriber(subscription, progress)
      }
    })

    this.eventBus.emit('progress:subscribed', {
      sessionId,
      subscriptionId,
      options: subscription.options
    })

    return subscriptionId
  }

  unsubscribe(sessionId: string, subscriptionId: string): void {
    const sessionSubscriptions = this.subscriptions.get(sessionId)
    if (sessionSubscriptions) {
      sessionSubscriptions.delete(subscriptionId)
      
      if (sessionSubscriptions.size === 0) {
        this.subscriptions.delete(sessionId)
        this.cleanupSessionData(sessionId)
      }
    }

    this.eventBus.emit('progress:unsubscribed', {
      sessionId,
      subscriptionId
    })
  }

  unsubscribeAll(sessionId: string): void {
    const sessionSubscriptions = this.subscriptions.get(sessionId)
    if (sessionSubscriptions) {
      const subscriptionIds = Array.from(sessionSubscriptions.keys())
      this.subscriptions.delete(sessionId)
      this.cleanupSessionData(sessionId)

      this.eventBus.emit('progress:unsubscribed:all', {
        sessionId,
        count: subscriptionIds.length
      })
    }
  }

  async getCurrentProgress(sessionId: string): Promise<ProgressInfo | undefined> {
    this.statistics.cacheRequests++

    // 检查缓存
    const cached = this.progressCache.get(sessionId)
    if (cached && this.isCacheValid(cached)) {
      this.statistics.cacheHits++
      return cached
    }

    // 从数据源获取最新进度
    const progress = await this.calculateProgress(sessionId)
    if (progress) {
      this.progressCache.set(sessionId, progress)
      this.addToHistory(sessionId, progress)
    }

    return progress
  }

  async getBatchProgress(sessionIds: string[]): Promise<Map<string, ProgressInfo>> {
    const result = new Map<string, ProgressInfo>()
    
    const promises = sessionIds.map(async sessionId => {
      const progress = await this.getCurrentProgress(sessionId)
      if (progress) {
        result.set(sessionId, progress)
      }
    })

    await Promise.all(promises)
    return result
  }

  updateProgress(sessionId: string, progress: Partial<ProgressInfo>): void {
    const currentProgress = this.progressCache.get(sessionId)
    if (!currentProgress) {
      return
    }

    const updatedProgress: ProgressInfo = {
      ...currentProgress,
      ...progress,
      lastUpdateTime: Date.now()
    }

    // 更新速度计算器
    this.updateSpeedCalculator(sessionId, updatedProgress)

    // 重新计算速度和预计时间
    const speedCalc = this.speedCalculator.get(sessionId)
    if (speedCalc) {
      updatedProgress.speed = speedCalc.getCurrentSpeed()
      updatedProgress.averageSpeed = speedCalc.getAverageSpeed()
      updatedProgress.peakSpeed = speedCalc.getPeakSpeed()
      updatedProgress.remainingTime = this.calculateRemainingTime(updatedProgress)
      updatedProgress.estimatedCompletion = Date.now() + updatedProgress.remainingTime
    }

    this.progressCache.set(sessionId, updatedProgress)
    this.addToHistory(sessionId, updatedProgress)

    // 通知订阅者
    this.notifySubscribers(sessionId, updatedProgress)
  }

  getProgressHistory(sessionId: string, limit: number = 100): ProgressInfo[] {
    const history = this.progressHistory.get(sessionId) || []
    return history.slice(-limit)
  }

  getStatistics(): ProgressStatistics {
    const totalSubscriptions = Array.from(this.subscriptions.values())
      .reduce((sum, sessionSubs) => sum + sessionSubs.size, 0)

    const activeSubscriptions = totalSubscriptions // 简化实现

    const timeDiff = Date.now() - this.statistics.lastStatsReset
    const averageNotificationRate = timeDiff > 0 
      ? (this.statistics.totalNotifications / timeDiff) * 1000 * 60 // 每分钟
      : 0

    const cacheHitRate = this.statistics.cacheRequests > 0
      ? (this.statistics.cacheHits / this.statistics.cacheRequests) * 100
      : 0

    return {
      totalSubscriptions,
      activeSubscriptions,
      totalNotifications: this.statistics.totalNotifications,
      averageNotificationRate,
      peakNotificationRate: this.statistics.notificationsInLastMinute,
      cacheHitRate
    }
  }

  cleanup(): void {
    const now = Date.now()
    const maxAge = 24 * 60 * 60 * 1000 // 24小时

    // 清理过期的进度缓存
    this.progressCache.forEach((progress, sessionId) => {
      if (now - progress.lastUpdateTime > maxAge) {
        this.progressCache.delete(sessionId)
      }
    })

    // 清理过期的历史记录
    this.progressHistory.forEach((history, sessionId) => {
      const filteredHistory = history.filter(p => now - p.lastUpdateTime < maxAge)
      if (filteredHistory.length === 0) {
        this.progressHistory.delete(sessionId)
      } else {
        this.progressHistory.set(sessionId, filteredHistory)
      }
    })

    // 清理无效的订阅
    this.subscriptions.forEach((sessionSubs, sessionId) => {
      sessionSubs.forEach((subscription, subscriptionId) => {
        if (now - subscription.createdAt > maxAge) {
          sessionSubs.delete(subscriptionId)
        }
      })

      if (sessionSubs.size === 0) {
        this.subscriptions.delete(sessionId)
      }
    })

    this.eventBus.emit('progress:cleanup:completed', {
      timestamp: now,
      cacheSize: this.progressCache.size,
      historySize: this.progressHistory.size,
      subscriptionCount: this.subscriptions.size
    })
  }

  private async calculateProgress(sessionId: string): Promise<ProgressInfo | undefined> {
    try {
      const session = await this.sessionManager.getSession(sessionId)
      if (!session) {
        return undefined
      }

      const stats = await this.chunkManager.getUploadStats(sessionId)
      const sessionState = this.stateManager.getState(`session:${sessionId}`) as any

      const now = Date.now()
      const startTime = sessionState?.startTime || session.createdAt

      // 获取或创建速度计算器
      let speedCalc = this.speedCalculator.get(sessionId)
      if (!speedCalc) {
        speedCalc = new SpeedCalculator()
        this.speedCalculator.set(sessionId, speedCalc)
      }

      const progress: ProgressInfo = {
        sessionId,
        uploadedSize: stats.uploadedSize,
        totalSize: stats.totalSize,
        uploadedChunks: stats.completedChunks,
        totalChunks: stats.totalChunks,
        percentage: stats.progress,
        speed: speedCalc.getCurrentSpeed(),
        remainingTime: 0,
        status: session.status,
        startTime,
        lastUpdateTime: now,
        averageSpeed: speedCalc.getAverageSpeed(),
        peakSpeed: speedCalc.getPeakSpeed(),
        estimatedCompletion: 0
      }

      progress.remainingTime = this.calculateRemainingTime(progress)
      progress.estimatedCompletion = now + progress.remainingTime

      return progress
    } catch (error) {
      console.error(`Failed to calculate progress for session ${sessionId}:`, error)
      return undefined
    }
  }

  private calculateRemainingTime(progress: ProgressInfo): number {
    if (progress.speed <= 0 || progress.percentage >= 100) {
      return 0
    }

    const remainingSize = progress.totalSize - progress.uploadedSize
    return Math.ceil(remainingSize / progress.speed) * 1000 // 转换为毫秒
  }

  private updateSpeedCalculator(sessionId: string, progress: ProgressInfo): void {
    let speedCalc = this.speedCalculator.get(sessionId)
    if (!speedCalc) {
      speedCalc = new SpeedCalculator()
      this.speedCalculator.set(sessionId, speedCalc)
    }

    speedCalc.addDataPoint(progress.uploadedSize, progress.lastUpdateTime)
  }

  private notifySubscribers(sessionId: string, progress: ProgressInfo): void {
    const sessionSubscriptions = this.subscriptions.get(sessionId)
    if (!sessionSubscriptions) {
      return
    }

    sessionSubscriptions.forEach(subscription => {
      this.notifySubscriber(subscription, progress)
    })
  }

  private notifySubscriber(subscription: ProgressSubscription, progress: ProgressInfo): void {
    const now = Date.now()
    const { options } = subscription

    // 检查节流
    if (options.throttle && now - subscription.lastNotified < options.throttle) {
      return
    }

    // 检查最小进度变化
    if (options.onlyOnChange && options.minProgressDelta) {
      const lastProgress = this.getLastNotifiedProgress(subscription.sessionId, subscription.id)
      if (lastProgress && Math.abs(progress.percentage - lastProgress.percentage) < options.minProgressDelta) {
        return
      }
    }

    // 过滤进度信息
    const filteredProgress = this.filterProgress(progress, options)

    try {
      subscription.callback(filteredProgress)
      subscription.lastNotified = now
      
      this.statistics.totalNotifications++
      this.statistics.notificationsInLastMinute++

      this.storeLastNotifiedProgress(subscription.sessionId, subscription.id, progress)
    } catch (error) {
      console.error(`Error in progress callback for subscription ${subscription.id}:`, error)
    }
  }

  private filterProgress(progress: ProgressInfo, options: ProgressSubscriptionOptions): ProgressInfo {
    const filtered = { ...progress }

    if (!options.includeSpeed) {
      filtered.speed = 0
      filtered.averageSpeed = 0
      filtered.peakSpeed = 0
    }

    if (!options.includeETA) {
      filtered.remainingTime = 0
      filtered.estimatedCompletion = 0
    }

    return filtered
  }

  private getLastNotifiedProgress(sessionId: string, subscriptionId: string): ProgressInfo | undefined {
    return this.stateManager.getState(`progress:last:${sessionId}:${subscriptionId}`)
  }

  private storeLastNotifiedProgress(sessionId: string, subscriptionId: string, progress: ProgressInfo): void {
    this.stateManager.setState(`progress:last:${sessionId}:${subscriptionId}`, progress)
  }

  private addToHistory(sessionId: string, progress: ProgressInfo): void {
    if (!this.progressHistory.has(sessionId)) {
      this.progressHistory.set(sessionId, [])
    }

    const history = this.progressHistory.get(sessionId)!
    history.push(progress)

    // 限制历史记录数量
    if (history.length > 1000) {
      history.splice(0, history.length - 1000)
    }
  }

  private isCacheValid(progress: ProgressInfo): boolean {
    const maxAge = 5000 // 5秒缓存有效期
    return Date.now() - progress.lastUpdateTime < maxAge
  }

  private cleanupSessionData(sessionId: string): void {
    this.progressCache.delete(sessionId)
    this.progressHistory.delete(sessionId)
    this.speedCalculator.delete(sessionId)
  }

  private setupEventListeners(): void {
    // 监听分片完成事件
    this.eventBus.on('chunk:completed', (data) => {
      this.updateProgress(data.sessionId, {
        uploadedSize: data.size,
        uploadedChunks: data.index + 1
      })
    })

    // 监听分片进度事件
    this.eventBus.on('chunk:progress', (data) => {
      this.updateProgress(data.sessionId, {
        uploadedSize: data.uploadedBytes
      })
    })

    // 监听会话状态变化
    this.eventBus.on('session:updated', (data) => {
      if (data.updates.status) {
        this.updateProgress(data.sessionId, {
          status: data.updates.status
        })
      }
    })

    // 监听会话销毁事件
    this.eventBus.on('session:destroyed', (data) => {
      this.unsubscribeAll(data.sessionId)
    })
  }

  private startCleanupTimer(): void {
    this.cleanupTimer = this.timerService.setInterval(() => {
      this.cleanup()
    }, 10 * 60 * 1000) // 每10分钟清理一次
  }

  private startStatsTimer(): void {
    this.statsTimer = this.timerService.setInterval(() => {
      // 重置每分钟统计
      this.statistics.notificationsInLastMinute = 0
    }, 60 * 1000) // 每分钟重置
  }

  private generateSubscriptionId(): string {
    return `sub_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  // 清理资源
  dispose(): void {
    if (this.cleanupTimer) {
      this.timerService.clearTimer(this.cleanupTimer)
    }

    if (this.statsTimer) {
      this.timerService.clearTimer(this.statsTimer)
    }

    this.subscriptions.clear()
    this.progressCache.clear()
    this.progressHistory.clear()
    this.speedCalculator.clear()
  }
}

/**
 * 速度计算器
 */
class SpeedCalculator {
  private dataPoints: Array<{ size: number; timestamp: number }> = []
  private maxDataPoints = 10
  private peakSpeed = 0

  addDataPoint(size: number, timestamp: number): void {
    this.dataPoints.push({ size, timestamp })

    // 限制数据点数量
    if (this.dataPoints.length > this.maxDataPoints) {
      this.dataPoints.shift()
    }

    // 更新峰值速度
    const currentSpeed = this.getCurrentSpeed()
    if (currentSpeed > this.peakSpeed) {
      this.peakSpeed = currentSpeed
    }
  }

  getCurrentSpeed(): number {
    if (this.dataPoints.length < 2) {
      return 0
    }

    const latest = this.dataPoints[this.dataPoints.length - 1]
    const previous = this.dataPoints[this.dataPoints.length - 2]

    const sizeDiff = latest.size - previous.size
    const timeDiff = (latest.timestamp - previous.timestamp) / 1000 // 转换为秒

    return timeDiff > 0 ? sizeDiff / timeDiff : 0
  }

  getAverageSpeed(): number {
    if (this.dataPoints.length < 2) {
      return 0
    }

    const first = this.dataPoints[0]
    const last = this.dataPoints[this.dataPoints.length - 1]

    const sizeDiff = last.size - first.size
    const timeDiff = (last.timestamp - first.timestamp) / 1000

    return timeDiff > 0 ? sizeDiff / timeDiff : 0
  }

  getPeakSpeed(): number {
    return this.peakSpeed
  }
}

/**
 * 进度服务工厂
 */
export class ProgressServiceFactory {
  static create(
    eventBus: EventBusInterface,
    timerService: TimerServiceInterface,
    stateManager: StateManagerInterface,
    chunkManager: ChunkManagerInterface,
    sessionManager: SessionManagerInterface
  ): ProgressService {
    return new ProgressService(
      eventBus,
      timerService,
      stateManager,
      chunkManager,
      sessionManager
    )
  }
}