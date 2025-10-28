/**
 * 状态管理器 - 领域服务层
 * 提供集中式状态管理、持久化和变化通知
 */

import { EventBusInterface } from '../infrastructure/EventBus'
import { StorageAdapterInterface } from '../infrastructure/StorageAdapter'

export type StateChangeCallback<T> = (newValue: T, oldValue: T | undefined, key: string) => void

export interface StateSnapshot {
  timestamp: number
  states: Record<string, any>
  version: string
}

export interface StateManagerOptions {
  enablePersistence: boolean
  persistenceKey: string
  enableHistory: boolean
  maxHistorySize: number
  enableValidation: boolean
  autoSave: boolean
  autoSaveInterval: number
}

export interface StateValidator<T> {
  validate: (value: T) => boolean | string
  sanitize?: (value: T) => T
}

export interface StateManagerInterface {
  // 获取状态
  getState<T>(key: string): T | undefined
  // 设置状态
  setState<T>(key: string, value: T): void
  // 批量设置状态
  setBatchState(states: Record<string, any>): void
  // 删除状态
  deleteState(key: string): void
  // 检查状态是否存在
  hasState(key: string): boolean
  // 订阅状态变化
  subscribe<T>(key: string, callback: StateChangeCallback<T>): () => void
  // 取消订阅
  unsubscribe<T>(key: string, callback: StateChangeCallback<T>): void
  // 持久化状态
  persistState(sessionId: string): Promise<void>
  // 恢复状态
  restoreState(sessionId: string): Promise<void>
  // 清空所有状态
  clearAll(): void
  // 获取状态快照
  getSnapshot(): StateSnapshot
  // 恢复快照
  restoreSnapshot(snapshot: StateSnapshot): void
}

export class StateManager implements StateManagerInterface {
  private states: Map<string, any> = new Map()
  private subscribers: Map<string, Set<StateChangeCallback<any>>> = new Map()
  private validators: Map<string, StateValidator<any>> = new Map()
  private history: StateSnapshot[] = []
  private eventBus: EventBusInterface
  private storage?: StorageAdapterInterface
  private options: StateManagerOptions
  private autoSaveTimer?: number

  constructor(
    eventBus: EventBusInterface,
    storage?: StorageAdapterInterface,
    options?: Partial<StateManagerOptions>
  ) {
    this.eventBus = eventBus
    this.storage = storage
    this.options = {
      enablePersistence: true,
      persistenceKey: 'wf-upload-state',
      enableHistory: true,
      maxHistorySize: 50,
      enableValidation: true,
      autoSave: true,
      autoSaveInterval: 5000, // 5秒
      ...options
    }

    if (this.options.autoSave && this.storage) {
      this.startAutoSave()
    }
  }

  getState<T>(key: string): T | undefined {
    return this.states.get(key) as T | undefined
  }

  setState<T>(key: string, value: T): void {
    const oldValue = this.states.get(key)
    
    // 验证新值
    if (this.options.enableValidation && this.validators.has(key)) {
      const validator = this.validators.get(key)!
      const validationResult = validator.validate(value)
      
      if (typeof validationResult === 'string') {
        throw new Error(`State validation failed for key "${key}": ${validationResult}`)
      }
      
      if (!validationResult) {
        throw new Error(`State validation failed for key "${key}"`)
      }

      // 清理数据
      if (validator.sanitize) {
        value = validator.sanitize(value)
      }
    }

    // 检查值是否真的发生了变化
    if (this.deepEqual(oldValue, value)) {
      return
    }

    // 保存历史记录
    if (this.options.enableHistory) {
      this.saveToHistory()
    }

    // 设置新值
    this.states.set(key, value)

    // 通知订阅者
    this.notifySubscribers(key, value, oldValue)

    // 发布全局事件
    this.eventBus.emit('state:changed', {
      key,
      newValue: value,
      oldValue,
      timestamp: Date.now()
    })
  }

  setBatchState(states: Record<string, any>): void {
    const changes: Array<{ key: string; newValue: any; oldValue: any }> = []
    
    // 保存历史记录
    if (this.options.enableHistory) {
      this.saveToHistory()
    }

    // 批量设置状态
    Object.entries(states).forEach(([key, value]) => {
      const oldValue = this.states.get(key)
      
      // 验证
      if (this.options.enableValidation && this.validators.has(key)) {
        const validator = this.validators.get(key)!
        const validationResult = validator.validate(value)
        
        if (typeof validationResult === 'string' || !validationResult) {
          throw new Error(`Batch state validation failed for key "${key}"`)
        }

        if (validator.sanitize) {
          value = validator.sanitize(value)
        }
      }

      if (!this.deepEqual(oldValue, value)) {
        this.states.set(key, value)
        changes.push({ key, newValue: value, oldValue })
      }
    })

    // 通知所有变化
    changes.forEach(({ key, newValue, oldValue }) => {
      this.notifySubscribers(key, newValue, oldValue)
    })

    // 发布批量变化事件
    if (changes.length > 0) {
      this.eventBus.emit('state:batch:changed', {
        changes,
        timestamp: Date.now()
      })
    }
  }

  deleteState(key: string): void {
    if (!this.states.has(key)) {
      return
    }

    const oldValue = this.states.get(key)
    
    // 保存历史记录
    if (this.options.enableHistory) {
      this.saveToHistory()
    }

    this.states.delete(key)
    
    // 通知订阅者
    this.notifySubscribers(key, undefined, oldValue)

    // 发布删除事件
    this.eventBus.emit('state:deleted', {
      key,
      oldValue,
      timestamp: Date.now()
    })
  }

  hasState(key: string): boolean {
    return this.states.has(key)
  }

  subscribe<T>(key: string, callback: StateChangeCallback<T>): () => void {
    if (!this.subscribers.has(key)) {
      this.subscribers.set(key, new Set())
    }
    
    this.subscribers.get(key)!.add(callback)

    // 返回取消订阅函数
    return () => {
      this.unsubscribe(key, callback)
    }
  }

  unsubscribe<T>(key: string, callback: StateChangeCallback<T>): void {
    const keySubscribers = this.subscribers.get(key)
    if (keySubscribers) {
      keySubscribers.delete(callback)
      
      // 如果没有订阅者了，删除整个集合
      if (keySubscribers.size === 0) {
        this.subscribers.delete(key)
      }
    }
  }

  async persistState(sessionId: string): Promise<void> {
    if (!this.storage) {
      throw new Error('Storage adapter not available for persistence')
    }

    const snapshot = this.getSnapshot()
    const persistenceKey = `${this.options.persistenceKey}:${sessionId}`
    
    await this.storage.store(persistenceKey, snapshot)
    
    this.eventBus.emit('state:persisted', {
      sessionId,
      timestamp: snapshot.timestamp,
      stateCount: Object.keys(snapshot.states).length
    })
  }

  async restoreState(sessionId: string): Promise<void> {
    if (!this.storage) {
      throw new Error('Storage adapter not available for restoration')
    }

    const persistenceKey = `${this.options.persistenceKey}:${sessionId}`
    const snapshot = await this.storage.retrieve<StateSnapshot>(persistenceKey)
    
    if (snapshot) {
      this.restoreSnapshot(snapshot)
      
      this.eventBus.emit('state:restored', {
        sessionId,
        timestamp: snapshot.timestamp,
        stateCount: Object.keys(snapshot.states).length
      })
    }
  }

  clearAll(): void {
    // 保存历史记录
    if (this.options.enableHistory) {
      this.saveToHistory()
    }

    const oldStates = new Map(this.states)
    this.states.clear()

    // 通知所有订阅者
    oldStates.forEach((oldValue, key) => {
      this.notifySubscribers(key, undefined, oldValue)
    })

    this.eventBus.emit('state:cleared', {
      clearedCount: oldStates.size,
      timestamp: Date.now()
    })
  }

  getSnapshot(): StateSnapshot {
    return {
      timestamp: Date.now(),
      states: Object.fromEntries(this.states),
      version: '1.0.0'
    }
  }

  restoreSnapshot(snapshot: StateSnapshot): void {
    // 保存当前状态到历史
    if (this.options.enableHistory) {
      this.saveToHistory()
    }

    const oldStates = new Map(this.states)
    this.states.clear()

    // 恢复状态
    Object.entries(snapshot.states).forEach(([key, value]) => {
      this.states.set(key, value)
    })

    // 通知变化
    const allKeys = new Set([...oldStates.keys(), ...this.states.keys()])
    allKeys.forEach(key => {
      const oldValue = oldStates.get(key)
      const newValue = this.states.get(key)
      
      if (!this.deepEqual(oldValue, newValue)) {
        this.notifySubscribers(key, newValue, oldValue)
      }
    })

    this.eventBus.emit('state:snapshot:restored', {
      timestamp: snapshot.timestamp,
      version: snapshot.version,
      stateCount: Object.keys(snapshot.states).length
    })
  }

  // 添加状态验证器
  addValidator<T>(key: string, validator: StateValidator<T>): void {
    this.validators.set(key, validator)
  }

  // 移除状态验证器
  removeValidator(key: string): void {
    this.validators.delete(key)
  }

  // 获取历史记录
  getHistory(): StateSnapshot[] {
    return [...this.history]
  }

  // 回滚到指定历史点
  rollbackToHistory(index: number): void {
    if (index < 0 || index >= this.history.length) {
      throw new Error('Invalid history index')
    }

    const snapshot = this.history[index]
    this.restoreSnapshot(snapshot)
  }

  // 清空历史记录
  clearHistory(): void {
    this.history = []
  }

  // 获取状态统计信息
  getStats(): {
    stateCount: number
    subscriberCount: number
    historySize: number
    memoryUsage: number
  } {
    const stateCount = this.states.size
    const subscriberCount = Array.from(this.subscribers.values())
      .reduce((sum, set) => sum + set.size, 0)
    const historySize = this.history.length
    
    // 估算内存使用量（简化计算）
    const memoryUsage = JSON.stringify(Object.fromEntries(this.states)).length

    return {
      stateCount,
      subscriberCount,
      historySize,
      memoryUsage
    }
  }

  // 导出状态为JSON
  exportState(): string {
    return JSON.stringify(this.getSnapshot(), null, 2)
  }

  // 从JSON导入状态
  importState(jsonString: string): void {
    try {
      const snapshot = JSON.parse(jsonString) as StateSnapshot
      this.restoreSnapshot(snapshot)
    } catch (error) {
      throw new Error(`Failed to import state: ${error}`)
    }
  }

  private notifySubscribers<T>(key: string, newValue: T, oldValue: T | undefined): void {
    const keySubscribers = this.subscribers.get(key)
    if (keySubscribers) {
      keySubscribers.forEach(callback => {
        try {
          callback(newValue, oldValue, key)
        } catch (error) {
          console.error(`Error in state change callback for key "${key}":`, error)
        }
      })
    }
  }

  private saveToHistory(): void {
    if (!this.options.enableHistory) return

    const snapshot = this.getSnapshot()
    this.history.push(snapshot)

    // 限制历史记录大小
    if (this.history.length > this.options.maxHistorySize) {
      this.history.shift()
    }
  }

  private deepEqual(a: any, b: any): boolean {
    if (a === b) return true
    if (a == null || b == null) return false
    if (typeof a !== typeof b) return false

    if (typeof a === 'object') {
      const keysA = Object.keys(a)
      const keysB = Object.keys(b)
      
      if (keysA.length !== keysB.length) return false
      
      for (const key of keysA) {
        if (!keysB.includes(key)) return false
        if (!this.deepEqual(a[key], b[key])) return false
      }
      
      return true
    }

    return false
  }

  private startAutoSave(): void {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer)
    }

    this.autoSaveTimer = setInterval(async () => {
      try {
        if (this.storage && this.states.size > 0) {
          const snapshot = this.getSnapshot()
          await this.storage.store(this.options.persistenceKey, snapshot)
        }
      } catch (error) {
        console.error('Auto-save failed:', error)
      }
    }, this.options.autoSaveInterval) as any
  }

  // 清理资源
  dispose(): void {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer)
      this.autoSaveTimer = undefined
    }

    this.states.clear()
    this.subscribers.clear()
    this.validators.clear()
    this.history = []
  }
}

/**
 * 状态管理器工厂
 */
export class StateManagerFactory {
  static create(
    eventBus: EventBusInterface,
    storage?: StorageAdapterInterface,
    options?: Partial<StateManagerOptions>
  ): StateManager {
    return new StateManager(eventBus, storage, options)
  }

  static createWithPersistence(
    eventBus: EventBusInterface,
    storage: StorageAdapterInterface
  ): StateManager {
    return new StateManager(eventBus, storage, {
      enablePersistence: true,
      autoSave: true
    })
  }

  static createInMemory(eventBus: EventBusInterface): StateManager {
    return new StateManager(eventBus, undefined, {
      enablePersistence: false,
      autoSave: false
    })
  }
}