/**
 * 错误服务 - 应用服务层
 * 提供统一的错误处理、分类、重试策略和恢复机制
 */

import { EventBusInterface } from '../infrastructure/EventBus'
import { TimerServiceInterface } from '../infrastructure/TimerService'
import { StateManagerInterface } from '../domain/StateManager'
import { SessionManagerInterface } from '../domain/SessionManager'

export enum ErrorType {
  NETWORK_ERROR = 'NETWORK_ERROR',
  CHUNK_ERROR = 'CHUNK_ERROR',
  FILE_ERROR = 'FILE_ERROR',
  SESSION_ERROR = 'SESSION_ERROR',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  TIMEOUT_ERROR = 'TIMEOUT_ERROR',
  PERMISSION_ERROR = 'PERMISSION_ERROR',
  QUOTA_ERROR = 'QUOTA_ERROR',
  SERVER_ERROR = 'SERVER_ERROR',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR'
}

export enum ErrorSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical'
}

export interface UploadError {
  id: string
  sessionId: string
  type: ErrorType
  severity: ErrorSeverity
  code: string
  message: string
  details?: any
  timestamp: number
  retryable: boolean
  retryCount: number
  maxRetries: number
  context?: Record<string, any>
  stackTrace?: string
}

export interface ErrorHandlingResult {
  action: ErrorAction
  delay?: number
  shouldRetry: boolean
  shouldCancel: boolean
  shouldPause: boolean
  message?: string
}

export enum ErrorAction {
  RETRY = 'retry',
  CANCEL = 'cancel',
  PAUSE = 'pause',
  IGNORE = 'ignore',
  ESCALATE = 'escalate',
  RECOVER = 'recover'
}

export interface RetryStrategy {
  maxRetries: number
  baseDelay: number
  maxDelay: number
  backoffMultiplier: number
  jitter: boolean
}

export interface ErrorPattern {
  type: ErrorType
  codePattern?: RegExp
  messagePattern?: RegExp
  action: ErrorAction
  retryStrategy?: RetryStrategy
}

export interface ErrorStatistics {
  totalErrors: number
  errorsByType: Record<ErrorType, number>
  errorsBySeverity: Record<ErrorSeverity, number>
  retrySuccessRate: number
  averageRetryCount: number
  mostCommonErrors: Array<{ code: string; count: number }>
}

export interface ErrorServiceInterface {
  // 处理错误
  handleError(error: UploadError): Promise<ErrorHandlingResult>
  // 重试策略判断
  shouldRetry(error: UploadError, retryCount: number): boolean
  // 错误恢复
  recoverFromError(sessionId: string, error: UploadError): Promise<void>
  // 记录错误
  logError(error: UploadError): void
  // 获取错误历史
  getErrorHistory(sessionId: string, limit?: number): UploadError[]
  // 获取错误统计
  getErrorStatistics(): ErrorStatistics
  // 添加错误模式
  addErrorPattern(pattern: ErrorPattern): void
  // 清理错误记录
  cleanupErrors(): void
}

export class ErrorService implements ErrorServiceInterface {
  private eventBus: EventBusInterface
  private timerService: TimerServiceInterface
  private stateManager: StateManagerInterface
  private sessionManager: SessionManagerInterface

  private errorHistory: Map<string, UploadError[]> = new Map()
  private errorPatterns: ErrorPattern[] = []
  private retryTimers: Map<string, string> = new Map()
  
  private statistics = {
    totalErrors: 0,
    errorsByType: {} as Record<ErrorType, number>,
    errorsBySeverity: {} as Record<ErrorSeverity, number>,
    retryAttempts: 0,
    retrySuccesses: 0
  }

  private defaultRetryStrategy: RetryStrategy = {
    maxRetries: 3,
    baseDelay: 1000,
    maxDelay: 30000,
    backoffMultiplier: 2,
    jitter: true
  }

  constructor(
    eventBus: EventBusInterface,
    timerService: TimerServiceInterface,
    stateManager: StateManagerInterface,
    sessionManager: SessionManagerInterface
  ) {
    this.eventBus = eventBus
    this.timerService = timerService
    this.stateManager = stateManager
    this.sessionManager = sessionManager

    this.initializeDefaultPatterns()
    this.setupEventListeners()
  }

  async handleError(error: UploadError): Promise<ErrorHandlingResult> {
    // 记录错误
    this.logError(error)

    // 分类错误
    const classifiedError = this.classifyError(error)

    // 查找匹配的错误模式
    const pattern = this.findMatchingPattern(classifiedError)

    // 生成处理结果
    const result = await this.generateHandlingResult(classifiedError, pattern)

    // 执行错误处理动作
    await this.executeErrorAction(classifiedError, result)

    // 发布错误处理事件
    this.eventBus.emit('error:handled', {
      error: classifiedError,
      result,
      timestamp: Date.now()
    })

    return result
  }

  shouldRetry(error: UploadError, retryCount: number): boolean {
    if (!error.retryable) {
      return false
    }

    if (retryCount >= error.maxRetries) {
      return false
    }

    // 检查错误类型是否支持重试
    const nonRetryableTypes = [
      ErrorType.VALIDATION_ERROR,
      ErrorType.PERMISSION_ERROR,
      ErrorType.QUOTA_ERROR
    ]

    if (nonRetryableTypes.includes(error.type)) {
      return false
    }

    // 检查错误严重程度
    if (error.severity === ErrorSeverity.CRITICAL) {
      return false
    }

    return true
  }

  async recoverFromError(sessionId: string, error: UploadError): Promise<void> {
    try {
      const session = await this.sessionManager.getSession(sessionId)
      if (!session) {
        throw new Error(`Session ${sessionId} not found`)
      }

      // 根据错误类型执行不同的恢复策略
      switch (error.type) {
        case ErrorType.NETWORK_ERROR:
          await this.recoverFromNetworkError(sessionId, error)
          break
        
        case ErrorType.CHUNK_ERROR:
          await this.recoverFromChunkError(sessionId, error)
          break
        
        case ErrorType.SESSION_ERROR:
          await this.recoverFromSessionError(sessionId, error)
          break
        
        case ErrorType.TIMEOUT_ERROR:
          await this.recoverFromTimeoutError(sessionId, error)
          break
        
        default:
          await this.recoverFromGenericError(sessionId, error)
          break
      }

      this.eventBus.emit('error:recovered', {
        sessionId,
        errorId: error.id,
        errorType: error.type
      })

    } catch (recoveryError) {
      this.eventBus.emit('error:recovery:failed', {
        sessionId,
        originalError: error,
        recoveryError
      })
      throw recoveryError
    }
  }

  logError(error: UploadError): void {
    // 更新统计信息
    this.statistics.totalErrors++
    this.statistics.errorsByType[error.type] = (this.statistics.errorsByType[error.type] || 0) + 1
    this.statistics.errorsBySeverity[error.severity] = (this.statistics.errorsBySeverity[error.severity] || 0) + 1

    // 添加到历史记录
    if (!this.errorHistory.has(error.sessionId)) {
      this.errorHistory.set(error.sessionId, [])
    }
    
    const sessionErrors = this.errorHistory.get(error.sessionId)!
    sessionErrors.push(error)

    // 限制历史记录数量
    if (sessionErrors.length > 100) {
      sessionErrors.shift()
    }

    // 持久化错误信息
    this.stateManager.setState(`error:${error.id}`, error)

    // 发布错误事件
    this.eventBus.emit('error:logged', {
      error,
      totalErrors: this.statistics.totalErrors
    })
  }

  getErrorHistory(sessionId: string, limit: number = 50): UploadError[] {
    const sessionErrors = this.errorHistory.get(sessionId) || []
    return sessionErrors.slice(-limit)
  }

  getErrorStatistics(): ErrorStatistics {
    const retrySuccessRate = this.statistics.retryAttempts > 0
      ? (this.statistics.retrySuccesses / this.statistics.retryAttempts) * 100
      : 0

    const averageRetryCount = this.statistics.retrySuccesses > 0
      ? this.statistics.retryAttempts / this.statistics.retrySuccesses
      : 0

    // 计算最常见的错误
    const errorCounts: Record<string, number> = {}
    this.errorHistory.forEach(errors => {
      errors.forEach(error => {
        errorCounts[error.code] = (errorCounts[error.code] || 0) + 1
      })
    })

    const mostCommonErrors = Object.entries(errorCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([code, count]) => ({ code, count }))

    return {
      totalErrors: this.statistics.totalErrors,
      errorsByType: this.statistics.errorsByType,
      errorsBySeverity: this.statistics.errorsBySeverity,
      retrySuccessRate,
      averageRetryCount,
      mostCommonErrors
    }
  }

  addErrorPattern(pattern: ErrorPattern): void {
    this.errorPatterns.push(pattern)
  }

  cleanupErrors(): void {
    const maxAge = 24 * 60 * 60 * 1000 // 24小时
    const now = Date.now()

    this.errorHistory.forEach((errors, sessionId) => {
      const filteredErrors = errors.filter(error => now - error.timestamp < maxAge)
      
      if (filteredErrors.length === 0) {
        this.errorHistory.delete(sessionId)
      } else {
        this.errorHistory.set(sessionId, filteredErrors)
      }
    })

    this.eventBus.emit('error:cleanup:completed', {
      timestamp: now,
      remainingSessions: this.errorHistory.size
    })
  }

  private classifyError(error: UploadError): UploadError {
    const classified = { ...error }

    // 自动分类错误类型
    if (!classified.type || classified.type === ErrorType.UNKNOWN_ERROR) {
      classified.type = this.detectErrorType(error)
    }

    // 自动设置严重程度
    if (!classified.severity) {
      classified.severity = this.detectErrorSeverity(classified)
    }

    // 设置重试能力
    if (classified.retryable === undefined) {
      classified.retryable = this.isErrorRetryable(classified)
    }

    return classified
  }

  private detectErrorType(error: UploadError): ErrorType {
    const message = error.message.toLowerCase()
    const code = error.code.toLowerCase()

    if (message.includes('network') || message.includes('connection') || code.includes('net')) {
      return ErrorType.NETWORK_ERROR
    }

    if (message.includes('timeout') || code.includes('timeout')) {
      return ErrorType.TIMEOUT_ERROR
    }

    if (message.includes('permission') || message.includes('unauthorized') || code.includes('auth')) {
      return ErrorType.PERMISSION_ERROR
    }

    if (message.includes('quota') || message.includes('limit') || code.includes('quota')) {
      return ErrorType.QUOTA_ERROR
    }

    if (message.includes('validation') || message.includes('invalid') || code.includes('valid')) {
      return ErrorType.VALIDATION_ERROR
    }

    if (message.includes('chunk') || code.includes('chunk')) {
      return ErrorType.CHUNK_ERROR
    }

    if (message.includes('session') || code.includes('session')) {
      return ErrorType.SESSION_ERROR
    }

    if (message.includes('server') || code.startsWith('5')) {
      return ErrorType.SERVER_ERROR
    }

    return ErrorType.UNKNOWN_ERROR
  }

  private detectErrorSeverity(error: UploadError): ErrorSeverity {
    switch (error.type) {
      case ErrorType.VALIDATION_ERROR:
      case ErrorType.PERMISSION_ERROR:
        return ErrorSeverity.HIGH

      case ErrorType.QUOTA_ERROR:
      case ErrorType.SERVER_ERROR:
        return ErrorSeverity.CRITICAL

      case ErrorType.NETWORK_ERROR:
      case ErrorType.TIMEOUT_ERROR:
        return ErrorSeverity.MEDIUM

      case ErrorType.CHUNK_ERROR:
      case ErrorType.SESSION_ERROR:
        return ErrorSeverity.LOW

      default:
        return ErrorSeverity.MEDIUM
    }
  }

  private isErrorRetryable(error: UploadError): boolean {
    const nonRetryableTypes = [
      ErrorType.VALIDATION_ERROR,
      ErrorType.PERMISSION_ERROR,
      ErrorType.QUOTA_ERROR
    ]

    return !nonRetryableTypes.includes(error.type) && 
           error.severity !== ErrorSeverity.CRITICAL
  }

  private findMatchingPattern(error: UploadError): ErrorPattern | undefined {
    return this.errorPatterns.find(pattern => {
      if (pattern.type !== error.type) {
        return false
      }

      if (pattern.codePattern && !pattern.codePattern.test(error.code)) {
        return false
      }

      if (pattern.messagePattern && !pattern.messagePattern.test(error.message)) {
        return false
      }

      return true
    })
  }

  private async generateHandlingResult(error: UploadError, pattern?: ErrorPattern): Promise<ErrorHandlingResult> {
    const shouldRetry = this.shouldRetry(error, error.retryCount)
    
    if (pattern) {
      const strategy = pattern.retryStrategy || this.defaultRetryStrategy
      const delay = this.calculateRetryDelay(error.retryCount, strategy)

      return {
        action: pattern.action,
        delay,
        shouldRetry: pattern.action === ErrorAction.RETRY && shouldRetry,
        shouldCancel: pattern.action === ErrorAction.CANCEL,
        shouldPause: pattern.action === ErrorAction.PAUSE
      }
    }

    // 默认处理逻辑
    if (shouldRetry) {
      const delay = this.calculateRetryDelay(error.retryCount, this.defaultRetryStrategy)
      return {
        action: ErrorAction.RETRY,
        delay,
        shouldRetry: true,
        shouldCancel: false,
        shouldPause: false
      }
    }

    if (error.severity === ErrorSeverity.CRITICAL) {
      return {
        action: ErrorAction.CANCEL,
        shouldRetry: false,
        shouldCancel: true,
        shouldPause: false,
        message: 'Critical error occurred, cancelling upload'
      }
    }

    return {
      action: ErrorAction.PAUSE,
      shouldRetry: false,
      shouldCancel: false,
      shouldPause: true,
      message: 'Upload paused due to error'
    }
  }

  private calculateRetryDelay(retryCount: number, strategy: RetryStrategy): number {
    let delay = strategy.baseDelay * Math.pow(strategy.backoffMultiplier, retryCount)
    delay = Math.min(delay, strategy.maxDelay)

    if (strategy.jitter) {
      delay += Math.random() * 1000 // 添加随机抖动
    }

    return delay
  }

  private async executeErrorAction(error: UploadError, result: ErrorHandlingResult): Promise<void> {
    switch (result.action) {
      case ErrorAction.RETRY:
        await this.scheduleRetry(error, result.delay || 0)
        break

      case ErrorAction.CANCEL:
        await this.cancelSession(error.sessionId)
        break

      case ErrorAction.PAUSE:
        await this.pauseSession(error.sessionId)
        break

      case ErrorAction.RECOVER:
        await this.recoverFromError(error.sessionId, error)
        break

      case ErrorAction.IGNORE:
        // 什么都不做
        break

      case ErrorAction.ESCALATE:
        await this.escalateError(error)
        break
    }
  }

  private async scheduleRetry(error: UploadError, delay: number): Promise<void> {
    this.statistics.retryAttempts++

    const timerId = this.timerService.setTimeout(async () => {
      try {
        await this.recoverFromError(error.sessionId, error)
        this.statistics.retrySuccesses++
        this.retryTimers.delete(error.id)
      } catch (retryError) {
        // 重试失败，可能需要进一步处理
        this.eventBus.emit('error:retry:failed', {
          originalError: error,
          retryError
        })
      }
    }, delay)

    this.retryTimers.set(error.id, timerId)
  }

  private async cancelSession(sessionId: string): Promise<void> {
    await this.sessionManager.destroySession(sessionId)
  }

  private async pauseSession(sessionId: string): Promise<void> {
    await this.sessionManager.pauseSession(sessionId)
  }

  private async escalateError(error: UploadError): Promise<void> {
    this.eventBus.emit('error:escalated', {
      error,
      timestamp: Date.now()
    })
  }

  private async recoverFromNetworkError(sessionId: string, _error: UploadError): Promise<void> {
    // 网络错误恢复：重新建立连接，重试失败的分片
    this.eventBus.emit('upload:retry', { sessionId })
  }

  private async recoverFromChunkError(sessionId: string, error: UploadError): Promise<void> {
    // 分片错误恢复：重新上传失败的分片
    if (error.context?.chunkId) {
      this.eventBus.emit('chunk:retry', { 
        sessionId, 
        chunkId: error.context.chunkId 
      })
    }
  }

  private async recoverFromSessionError(sessionId: string, _error: UploadError): Promise<void> {
    // 会话错误恢复：重新创建会话或恢复会话状态
    await this.sessionManager.resumeSession(sessionId)
  }

  private async recoverFromTimeoutError(sessionId: string, _error: UploadError): Promise<void> {
    // 超时错误恢复：增加超时时间，重试操作
    this.eventBus.emit('upload:retry', { sessionId })
  }

  private async recoverFromGenericError(sessionId: string, _error: UploadError): Promise<void> {
    // 通用错误恢复：暂停一段时间后重试
    await new Promise(resolve => setTimeout(resolve, 5000))
    this.eventBus.emit('upload:retry', { sessionId })
  }

  private initializeDefaultPatterns(): void {
    // 网络错误模式
    this.addErrorPattern({
      type: ErrorType.NETWORK_ERROR,
      action: ErrorAction.RETRY,
      retryStrategy: {
        maxRetries: 5,
        baseDelay: 2000,
        maxDelay: 60000,
        backoffMultiplier: 2,
        jitter: true
      }
    })

    // 超时错误模式
    this.addErrorPattern({
      type: ErrorType.TIMEOUT_ERROR,
      action: ErrorAction.RETRY,
      retryStrategy: {
        maxRetries: 3,
        baseDelay: 5000,
        maxDelay: 30000,
        backoffMultiplier: 1.5,
        jitter: true
      }
    })

    // 服务器错误模式
    this.addErrorPattern({
      type: ErrorType.SERVER_ERROR,
      codePattern: /^5\d{2}$/,
      action: ErrorAction.RETRY,
      retryStrategy: {
        maxRetries: 2,
        baseDelay: 10000,
        maxDelay: 60000,
        backoffMultiplier: 3,
        jitter: true
      }
    })

    // 权限错误模式
    this.addErrorPattern({
      type: ErrorType.PERMISSION_ERROR,
      action: ErrorAction.CANCEL
    })

    // 配额错误模式
    this.addErrorPattern({
      type: ErrorType.QUOTA_ERROR,
      action: ErrorAction.PAUSE
    })
  }

  private setupEventListeners(): void {
    // 监听会话销毁事件，清理相关错误记录
    this.eventBus.on('session:destroyed', (data) => {
      this.errorHistory.delete(data.sessionId)
    })
  }

  // 清理资源
  dispose(): void {
    // 清除所有重试定时器
    this.retryTimers.forEach(timerId => {
      this.timerService.clearTimer(timerId)
    })
    this.retryTimers.clear()

    this.errorHistory.clear()
    this.errorPatterns = []
  }
}

/**
 * 错误服务工厂
 */
export class ErrorServiceFactory {
  static create(
    eventBus: EventBusInterface,
    timerService: TimerServiceInterface,
    stateManager: StateManagerInterface,
    sessionManager: SessionManagerInterface
  ): ErrorService {
    return new ErrorService(eventBus, timerService, stateManager, sessionManager)
  }

  static createWithCustomPatterns(
    eventBus: EventBusInterface,
    timerService: TimerServiceInterface,
    stateManager: StateManagerInterface,
    sessionManager: SessionManagerInterface,
    customPatterns: ErrorPattern[]
  ): ErrorService {
    const service = new ErrorService(eventBus, timerService, stateManager, sessionManager)
    customPatterns.forEach(pattern => service.addErrorPattern(pattern))
    return service
  }
}