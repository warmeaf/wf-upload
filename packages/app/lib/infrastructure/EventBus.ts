/**
 * 事件总线 - 基础设施层
 * 提供解耦的组件间通信机制
 */

export type EventCallback = (...args: any[]) => void
export type EventFilter = (data: any) => boolean

export interface EventBusInterface {
  // 发布事件
  emit(event: string, data?: any): void
  // 订阅事件
  on(event: string, callback: EventCallback): void
  // 取消订阅
  off(event: string, callback: EventCallback): void
  // 一次性订阅
  once(event: string, callback: EventCallback): void
  // 带过滤器的订阅
  onFiltered(event: string, callback: EventCallback, filter: EventFilter): void
  // 清空所有监听器
  clear(): void
  // 获取事件监听器数量
  getListenerCount(event: string): number
}

export class EventBus implements EventBusInterface {
  private listeners: Map<string, Set<EventCallback>> = new Map()
  private onceListeners: Map<string, Set<EventCallback>> = new Map()
  private filteredListeners: Map<string, Map<EventCallback, EventFilter>> = new Map()

  emit(event: string, data?: any): void {
    // 处理普通监听器
    const eventListeners = this.listeners.get(event)
    if (eventListeners) {
      eventListeners.forEach(callback => {
        try {
          callback(data)
        } catch (error) {
          console.error(`Error in event listener for "${event}":`, error)
        }
      })
    }

    // 处理一次性监听器
    const onceListeners = this.onceListeners.get(event)
    if (onceListeners) {
      const listenersToRemove = Array.from(onceListeners)
      onceListeners.clear()
      listenersToRemove.forEach(callback => {
        try {
          callback(data)
        } catch (error) {
          console.error(`Error in once listener for "${event}":`, error)
        }
      })
    }

    // 处理带过滤器的监听器
    const filteredListeners = this.filteredListeners.get(event)
    if (filteredListeners) {
      filteredListeners.forEach((filter, callback) => {
        try {
          if (filter(data)) {
            callback(data)
          }
        } catch (error) {
          console.error(`Error in filtered listener for "${event}":`, error)
        }
      })
    }
  }

  on(event: string, callback: EventCallback): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set())
    }
    this.listeners.get(event)!.add(callback)
  }

  off(event: string, callback: EventCallback): void {
    // 从普通监听器中移除
    const eventListeners = this.listeners.get(event)
    if (eventListeners) {
      eventListeners.delete(callback)
      if (eventListeners.size === 0) {
        this.listeners.delete(event)
      }
    }

    // 从一次性监听器中移除
    const onceListeners = this.onceListeners.get(event)
    if (onceListeners) {
      onceListeners.delete(callback)
      if (onceListeners.size === 0) {
        this.onceListeners.delete(event)
      }
    }

    // 从过滤监听器中移除
    const filteredListeners = this.filteredListeners.get(event)
    if (filteredListeners) {
      filteredListeners.delete(callback)
      if (filteredListeners.size === 0) {
        this.filteredListeners.delete(event)
      }
    }
  }

  once(event: string, callback: EventCallback): void {
    if (!this.onceListeners.has(event)) {
      this.onceListeners.set(event, new Set())
    }
    this.onceListeners.get(event)!.add(callback)
  }

  onFiltered(event: string, callback: EventCallback, filter: EventFilter): void {
    if (!this.filteredListeners.has(event)) {
      this.filteredListeners.set(event, new Map())
    }
    this.filteredListeners.get(event)!.set(callback, filter)
  }

  clear(): void {
    this.listeners.clear()
    this.onceListeners.clear()
    this.filteredListeners.clear()
  }

  getListenerCount(event: string): number {
    let count = 0
    
    const eventListeners = this.listeners.get(event)
    if (eventListeners) {
      count += eventListeners.size
    }

    const onceListeners = this.onceListeners.get(event)
    if (onceListeners) {
      count += onceListeners.size
    }

    const filteredListeners = this.filteredListeners.get(event)
    if (filteredListeners) {
      count += filteredListeners.size
    }

    return count
  }

  // 获取所有事件名称
  getEventNames(): string[] {
    const events = new Set<string>()
    
    this.listeners.forEach((_, event) => events.add(event))
    this.onceListeners.forEach((_, event) => events.add(event))
    this.filteredListeners.forEach((_, event) => events.add(event))
    
    return Array.from(events)
  }

  // 调试方法：获取事件总线状态
  getDebugInfo(): {
    totalEvents: number
    totalListeners: number
    events: Record<string, number>
  } {
    const events: Record<string, number> = {}
    let totalListeners = 0

    this.getEventNames().forEach(event => {
      const count = this.getListenerCount(event)
      events[event] = count
      totalListeners += count
    })

    return {
      totalEvents: Object.keys(events).length,
      totalListeners,
      events
    }
  }
}

// 全局事件总线实例
export const globalEventBus = new EventBus()