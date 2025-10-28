/**
 * 定时器服务 - 基础设施层
 * 管理定时任务和间隔器的生命周期
 */

export interface TimerInfo {
  id: string
  type: 'timeout' | 'interval'
  callback: Function
  delay: number
  createdAt: number
  lastExecutedAt?: number
  executionCount: number
  isActive: boolean
}

export interface TimerServiceInterface {
  // 设置定时器
  setTimeout(callback: Function, delay: number): string
  // 设置间隔器
  setInterval(callback: Function, interval: number): string
  // 清除定时器
  clearTimer(timerId: string): void
  // 暂停所有定时器
  pauseAll(): void
  // 恢复所有定时器
  resumeAll(): void
  // 清除所有定时器
  clearAll(): void
  // 获取定时器信息
  getTimerInfo(timerId: string): TimerInfo | undefined
  // 获取所有定时器信息
  getAllTimers(): TimerInfo[]
  // 获取活跃定时器数量
  getActiveCount(): number
}

export class TimerService implements TimerServiceInterface {
  private timers: Map<string, TimerInfo> = new Map()
  private nativeTimers: Map<string, number> = new Map()
  private isPaused: boolean = false
  private pausedTimers: Map<string, { remainingTime: number; startTime: number }> = new Map()

  setTimeout(callback: Function, delay: number): string {
    const timerId = this.generateTimerId()
    const timerInfo: TimerInfo = {
      id: timerId,
      type: 'timeout',
      callback,
      delay,
      createdAt: Date.now(),
      executionCount: 0,
      isActive: true
    }

    this.timers.set(timerId, timerInfo)

    if (!this.isPaused) {
      this.scheduleTimeout(timerId, delay)
    } else {
      this.pausedTimers.set(timerId, { remainingTime: delay, startTime: Date.now() })
    }

    return timerId
  }

  setInterval(callback: Function, interval: number): string {
    const timerId = this.generateTimerId()
    const timerInfo: TimerInfo = {
      id: timerId,
      type: 'interval',
      callback,
      delay: interval,
      createdAt: Date.now(),
      executionCount: 0,
      isActive: true
    }

    this.timers.set(timerId, timerInfo)

    if (!this.isPaused) {
      this.scheduleInterval(timerId, interval)
    } else {
      this.pausedTimers.set(timerId, { remainingTime: interval, startTime: Date.now() })
    }

    return timerId
  }

  clearTimer(timerId: string): void {
    const timerInfo = this.timers.get(timerId)
    if (timerInfo) {
      timerInfo.isActive = false
      this.timers.delete(timerId)
    }

    const nativeTimerId = this.nativeTimers.get(timerId)
    if (nativeTimerId !== undefined) {
      if (timerInfo?.type === 'timeout') {
        clearTimeout(nativeTimerId)
      } else if (timerInfo?.type === 'interval') {
        clearInterval(nativeTimerId)
      }
      this.nativeTimers.delete(timerId)
    }

    this.pausedTimers.delete(timerId)
  }

  pauseAll(): void {
    if (this.isPaused) return

    this.isPaused = true
    const now = Date.now()

    this.timers.forEach((timerInfo, timerId) => {
      if (!timerInfo.isActive) return

      const nativeTimerId = this.nativeTimers.get(timerId)
      if (nativeTimerId !== undefined) {
        // 清除原生定时器
        if (timerInfo.type === 'timeout') {
          clearTimeout(nativeTimerId)
        } else {
          clearInterval(nativeTimerId)
        }
        this.nativeTimers.delete(timerId)

        // 计算剩余时间
        let remainingTime = timerInfo.delay
        if (timerInfo.type === 'timeout' && timerInfo.lastExecutedAt) {
          const elapsed = now - timerInfo.lastExecutedAt
          remainingTime = Math.max(0, timerInfo.delay - elapsed)
        }

        this.pausedTimers.set(timerId, { remainingTime, startTime: now })
      }
    })
  }

  resumeAll(): void {
    if (!this.isPaused) return

    this.isPaused = false

    this.pausedTimers.forEach((pausedInfo, timerId) => {
      const timerInfo = this.timers.get(timerId)
      if (timerInfo && timerInfo.isActive) {
        if (timerInfo.type === 'timeout') {
          this.scheduleTimeout(timerId, pausedInfo.remainingTime)
        } else {
          this.scheduleInterval(timerId, timerInfo.delay)
        }
      }
    })

    this.pausedTimers.clear()
  }

  clearAll(): void {
    // 清除所有原生定时器
    this.nativeTimers.forEach((nativeTimerId, timerId) => {
      const timerInfo = this.timers.get(timerId)
      if (timerInfo?.type === 'timeout') {
        clearTimeout(nativeTimerId)
      } else if (timerInfo?.type === 'interval') {
        clearInterval(nativeTimerId)
      }
    })

    this.timers.clear()
    this.nativeTimers.clear()
    this.pausedTimers.clear()
    this.isPaused = false
  }

  getTimerInfo(timerId: string): TimerInfo | undefined {
    return this.timers.get(timerId)
  }

  getAllTimers(): TimerInfo[] {
    return Array.from(this.timers.values())
  }

  getActiveCount(): number {
    return Array.from(this.timers.values()).filter(timer => timer.isActive).length
  }

  // 获取定时器统计信息
  getStats(): {
    total: number
    active: number
    paused: number
    timeouts: number
    intervals: number
  } {
    const timers = Array.from(this.timers.values())
    const active = timers.filter(t => t.isActive).length
    const timeouts = timers.filter(t => t.type === 'timeout').length
    const intervals = timers.filter(t => t.type === 'interval').length

    return {
      total: timers.length,
      active,
      paused: this.pausedTimers.size,
      timeouts,
      intervals
    }
  }

  // 延迟执行函数
  delay(ms: number): Promise<void> {
    return new Promise(resolve => {
      this.setTimeout(resolve, ms)
    })
  }

  // 创建可取消的延迟
  createCancellableDelay(ms: number): {
    promise: Promise<void>
    cancel: () => void
  } {
    let timerId: string
    const promise = new Promise<void>((resolve) => {
      timerId = this.setTimeout(() => resolve(), ms)
    })

    const cancel = () => {
      if (timerId) {
        this.clearTimer(timerId)
      }
    }

    return { promise, cancel }
  }

  // 节流函数
  throttle<T extends (...args: any[]) => any>(
    func: T,
    delay: number
  ): (...args: Parameters<T>) => void {
    let timerId: string | null = null
    let lastExecTime = 0

    return (...args: Parameters<T>) => {
      const now = Date.now()
      
      if (now - lastExecTime >= delay) {
        func(...args)
        lastExecTime = now
      } else if (!timerId) {
        const remainingTime = delay - (now - lastExecTime)
        timerId = this.setTimeout(() => {
          func(...args)
          lastExecTime = Date.now()
          timerId = null
        }, remainingTime)
      }
    }
  }

  // 防抖函数
  debounce<T extends (...args: any[]) => any>(
    func: T,
    delay: number
  ): (...args: Parameters<T>) => void {
    let timerId: string | null = null

    return (...args: Parameters<T>) => {
      if (timerId) {
        this.clearTimer(timerId)
      }
      
      timerId = this.setTimeout(() => {
        func(...args)
        timerId = null
      }, delay)
    }
  }

  private scheduleTimeout(timerId: string, delay: number): void {
    const timerInfo = this.timers.get(timerId)
    if (!timerInfo || !timerInfo.isActive) return

    const nativeTimerId = setTimeout(() => {
      try {
        timerInfo.callback()
        timerInfo.executionCount++
        timerInfo.lastExecutedAt = Date.now()
      } catch (error) {
        console.error(`Error in timer ${timerId}:`, error)
      } finally {
        // 清理一次性定时器
        this.clearTimer(timerId)
      }
    }, delay) as any

    this.nativeTimers.set(timerId, nativeTimerId)
  }

  private scheduleInterval(timerId: string, interval: number): void {
    const timerInfo = this.timers.get(timerId)
    if (!timerInfo || !timerInfo.isActive) return

    const nativeTimerId = setInterval(() => {
      if (!timerInfo.isActive) {
        this.clearTimer(timerId)
        return
      }

      try {
        timerInfo.callback()
        timerInfo.executionCount++
        timerInfo.lastExecutedAt = Date.now()
      } catch (error) {
        console.error(`Error in interval ${timerId}:`, error)
      }
    }, interval) as any

    this.nativeTimers.set(timerId, nativeTimerId)
  }

  private generateTimerId(): string {
    return `timer_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }
}

// 全局定时器服务实例
export const globalTimerService = new TimerService()