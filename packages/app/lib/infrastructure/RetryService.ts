/**
 * 重试服务 - 基础设施层
 * 实现智能重试机制和错误恢复策略
 */

import { EventBusInterface } from './EventBus'

export interface RetryConfig {
  maxRetries: number
  baseDelay: number
  maxDelay: number
  backoffFactor: number
  retryableErrors: string[]
  enableJitter: boolean
}

export interface RetryResult {
  success: boolean
  attempts: number
  totalTime: number
  error?: Error
}

export interface RetryContext {
  id: string
  operation: string
  config: RetryConfig
  attempt: number
  startTime: number
  lastError?: Error
}

export class RetryService {
  private eventBus: EventBusInterface
  private activeRetries: Map<string, RetryContext> = new Map()
  private defaultConfig: RetryConfig = {
    maxRetries: 3,
    baseDelay: 1000, // 1秒
    maxDelay: 30000, // 30秒
    backoffFactor: 2,
    retryableErrors: [
      'NETWORK_ERROR',
      'TIMEOUT',
      'SERVER_ERROR',
      'UPLOAD_FAILED',
      'CONNECTION_LOST'
    ],
    enableJitter: true,
  }

  constructor(eventBus: EventBusInterface) {
    this.eventBus = eventBus
  }

  /**
   * 执行带重试机制的操作
   */
  async execute<T>(
    operation: () => Promise<T>,
    operationId: string,
    operationName: string,
    config?: Partial<RetryConfig>
  ): Promise<T> {
    const finalConfig = { ...this.defaultConfig, ...config }
    const context: RetryContext = {
      id: operationId,
      operation: operationName,
      config: finalConfig,
      attempt: 0,
      startTime: Date.now(),
    }

    this.activeRetries.set(operationId, context)
    this.eventBus.emit('retry:started', { id: operationId, operation: operationName })

    try {
      const result = await this.executeWithRetry(operation, context)
      this.activeRetries.delete(operationId)
      this.eventBus.emit('retry:completed', {
        id: operationId,
        operation: operationName,
        attempts: context.attempt,
        totalTime: Date.now() - context.startTime
      })
      return result
    } catch (error) {
      this.activeRetries.delete(operationId)
      this.eventBus.emit('retry:failed', {
        id: operationId,
        operation: operationName,
        attempts: context.attempt,
        totalTime: Date.now() - context.startTime,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      throw error
    }
  }

  /**
   * 检查错误是否可重试
   */
  isRetryableError(error: Error, config: RetryConfig): boolean {
    const errorMessage = error.message.toUpperCase()
    return config.retryableErrors.some(retryableError =>
      errorMessage.includes(retryableError) || error.name.includes(retryableError)
    )
  }

  /**
   * 计算重试延迟时间
   */
  calculateDelay(attempt: number, config: RetryConfig): number {
    let delay = config.baseDelay * Math.pow(config.backoffFactor, attempt - 1)
    delay = Math.min(delay, config.maxDelay)

    // 添加抖动以避免雷群效应
    if (config.enableJitter) {
      const jitter = delay * 0.1 * Math.random()
      delay += jitter
    }

    return Math.floor(delay)
  }

  /**
   * 取消重试
   */
  cancelRetry(operationId: string): boolean {
    const context = this.activeRetries.get(operationId)
    if (context) {
      this.activeRetries.delete(operationId)
      this.eventBus.emit('retry:cancelled', {
        id: operationId,
        operation: context.operation
      })
      return true
    }
    return false
  }

  /**
   * 获取活跃的重试信息
   */
  getActiveRetry(operationId: string): RetryContext | undefined {
    return this.activeRetries.get(operationId)
  }

  /**
   * 获取所有活跃的重试
   */
  getAllActiveRetries(): RetryContext[] {
    return Array.from(this.activeRetries.values())
  }

  /**
   * 更新重试配置
   */
  updateConfig(newConfig: Partial<RetryConfig>): void {
    this.defaultConfig = { ...this.defaultConfig, ...newConfig }
    this.eventBus.emit('retry:config:updated', { config: this.defaultConfig })
  }

  /**
   * 核心重试逻辑
   */
  private async executeWithRetry<T>(
    operation: () => Promise<T>,
    context: RetryContext
  ): Promise<T> {
    while (context.attempt < context.config.maxRetries) {
      context.attempt++

      try {
        this.eventBus.emit('retry:attempt', {
          id: context.id,
          operation: context.operation,
          attempt: context.attempt,
        })

        const result = await operation()

        if (context.attempt > 1) {
          this.eventBus.emit('retry:success', {
            id: context.id,
            operation: context.operation,
            attempt: context.attempt,
            totalTime: Date.now() - context.startTime,
          })
        }

        return result
      } catch (error) {
        context.lastError = error instanceof Error ? error : new Error(String(error))

        this.eventBus.emit('retry:error', {
          id: context.id,
          operation: context.operation,
          attempt: context.attempt,
          error: context.lastError.message,
        })

        // 检查是否可重试且还有重试次数
        if (!this.isRetryableError(context.lastError, context.config)) {
          throw context.lastError
        }

        if (context.attempt >= context.config.maxRetries) {
          throw context.lastError
        }

        // 等待延迟时间
        const delay = this.calculateDelay(context.attempt, context.config)
        this.eventBus.emit('retry:delay', {
          id: context.id,
          operation: context.operation,
          attempt: context.attempt,
          delay,
        })

        await this.sleep(delay)
      }
    }

    throw context.lastError || new Error('Max retries exceeded')
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  /**
   * 清理过期的重试上下文
   */
  cleanupExpiredRetries(maxAge: number = 300000): number { // 默认5分钟
    const now = Date.now()
    let cleanedCount = 0

    for (const [id, context] of this.activeRetries.entries()) {
      if (now - context.startTime > maxAge) {
        this.activeRetries.delete(id)
        cleanedCount++
      }
    }

    if (cleanedCount > 0) {
      this.eventBus.emit('retry:cleanup', { cleanedCount })
    }

    return cleanedCount
  }
}

/**
 * 重试服务工厂
 */
export class RetryServiceFactory {
  static create(eventBus: EventBusInterface, config?: Partial<RetryConfig>): RetryService {
    const retryService = new RetryService(eventBus)
    if (config) {
      retryService.updateConfig(config)
    }
    return retryService
  }
}