/**
 * 存储适配器 - 基础设施层
 * 抽象本地存储操作，支持多种存储方式
 */

export interface StorageAdapterInterface {
  // 存储数据
  store(key: string, data: any): Promise<void>
  // 获取数据
  retrieve<T>(key: string): Promise<T | undefined>
  // 删除数据
  remove(key: string): Promise<void>
  // 清空存储
  clear(): Promise<void>
  // 检查键是否存在
  exists(key: string): Promise<boolean>
  // 获取所有键
  keys(): Promise<string[]>
  // 获取存储大小
  size(): Promise<number>
}

/**
 * LocalStorage 适配器
 */
export class LocalStorageAdapter implements StorageAdapterInterface {
  private prefix: string

  constructor(prefix: string = 'wf-upload:') {
    this.prefix = prefix
  }

  async store(key: string, data: any): Promise<void> {
    try {
      const serializedData = JSON.stringify(data)
      localStorage.setItem(this.getKey(key), serializedData)
    } catch (error) {
      throw new Error(`Failed to store data for key "${key}": ${error}`)
    }
  }

  async retrieve<T>(key: string): Promise<T | undefined> {
    try {
      const serializedData = localStorage.getItem(this.getKey(key))
      if (serializedData === null) {
        return undefined
      }
      return JSON.parse(serializedData) as T
    } catch (error) {
      throw new Error(`Failed to retrieve data for key "${key}": ${error}`)
    }
  }

  async remove(key: string): Promise<void> {
    localStorage.removeItem(this.getKey(key))
  }

  async clear(): Promise<void> {
    const keys = await this.keys()
    keys.forEach(key => {
      localStorage.removeItem(this.getKey(key))
    })
  }

  async exists(key: string): Promise<boolean> {
    return localStorage.getItem(this.getKey(key)) !== null
  }

  async keys(): Promise<string[]> {
    const keys: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && key.startsWith(this.prefix)) {
        keys.push(key.substring(this.prefix.length))
      }
    }
    return keys
  }

  async size(): Promise<number> {
    const keys = await this.keys()
    return keys.length
  }

  private getKey(key: string): string {
    return `${this.prefix}${key}`
  }
}

/**
 * SessionStorage 适配器
 */
export class SessionStorageAdapter implements StorageAdapterInterface {
  private prefix: string

  constructor(prefix: string = 'wf-upload:') {
    this.prefix = prefix
  }

  async store(key: string, data: any): Promise<void> {
    try {
      const serializedData = JSON.stringify(data)
      sessionStorage.setItem(this.getKey(key), serializedData)
    } catch (error) {
      throw new Error(`Failed to store data for key "${key}": ${error}`)
    }
  }

  async retrieve<T>(key: string): Promise<T | undefined> {
    try {
      const serializedData = sessionStorage.getItem(this.getKey(key))
      if (serializedData === null) {
        return undefined
      }
      return JSON.parse(serializedData) as T
    } catch (error) {
      throw new Error(`Failed to retrieve data for key "${key}": ${error}`)
    }
  }

  async remove(key: string): Promise<void> {
    sessionStorage.removeItem(this.getKey(key))
  }

  async clear(): Promise<void> {
    const keys = await this.keys()
    keys.forEach(key => {
      sessionStorage.removeItem(this.getKey(key))
    })
  }

  async exists(key: string): Promise<boolean> {
    return sessionStorage.getItem(this.getKey(key)) !== null
  }

  async keys(): Promise<string[]> {
    const keys: string[] = []
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i)
      if (key && key.startsWith(this.prefix)) {
        keys.push(key.substring(this.prefix.length))
      }
    }
    return keys
  }

  async size(): Promise<number> {
    const keys = await this.keys()
    return keys.length
  }

  private getKey(key: string): string {
    return `${this.prefix}${key}`
  }
}

/**
 * IndexedDB 适配器
 */
export class IndexedDBAdapter implements StorageAdapterInterface {
  private dbName: string
  private storeName: string
  private version: number
  private db: IDBDatabase | null = null

  constructor(
    dbName: string = 'wf-upload-db',
    storeName: string = 'uploads',
    version: number = 1
  ) {
    this.dbName = dbName
    this.storeName = storeName
    this.version = version
  }

  private async getDB(): Promise<IDBDatabase> {
    if (this.db) {
      return this.db
    }

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version)

      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        this.db = request.result
        resolve(this.db)
      }

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName, { keyPath: 'key' })
        }
      }
    })
  }

  async store(key: string, data: any): Promise<void> {
    const db = await this.getDB()
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([this.storeName], 'readwrite')
      const store = transaction.objectStore(this.storeName)
      const request = store.put({ key, data, timestamp: Date.now() })

      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve()
    })
  }

  async retrieve<T>(key: string): Promise<T | undefined> {
    const db = await this.getDB()
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([this.storeName], 'readonly')
      const store = transaction.objectStore(this.storeName)
      const request = store.get(key)

      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const result = request.result
        resolve(result ? result.data : undefined)
      }
    })
  }

  async remove(key: string): Promise<void> {
    const db = await this.getDB()
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([this.storeName], 'readwrite')
      const store = transaction.objectStore(this.storeName)
      const request = store.delete(key)

      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve()
    })
  }

  async clear(): Promise<void> {
    const db = await this.getDB()
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([this.storeName], 'readwrite')
      const store = transaction.objectStore(this.storeName)
      const request = store.clear()

      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve()
    })
  }

  async exists(key: string): Promise<boolean> {
    const data = await this.retrieve(key)
    return data !== undefined
  }

  async keys(): Promise<string[]> {
    const db = await this.getDB()
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([this.storeName], 'readonly')
      const store = transaction.objectStore(this.storeName)
      const request = store.getAllKeys()

      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result as string[])
    })
  }

  async size(): Promise<number> {
    const db = await this.getDB()
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([this.storeName], 'readonly')
      const store = transaction.objectStore(this.storeName)
      const request = store.count()

      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result)
    })
  }
}

/**
 * 内存存储适配器（用于测试）
 */
export class MemoryStorageAdapter implements StorageAdapterInterface {
  private storage: Map<string, any> = new Map()

  async store(key: string, data: any): Promise<void> {
    this.storage.set(key, data)
  }

  async retrieve<T>(key: string): Promise<T | undefined> {
    return this.storage.get(key)
  }

  async remove(key: string): Promise<void> {
    this.storage.delete(key)
  }

  async clear(): Promise<void> {
    this.storage.clear()
  }

  async exists(key: string): Promise<boolean> {
    return this.storage.has(key)
  }

  async keys(): Promise<string[]> {
    return Array.from(this.storage.keys())
  }

  async size(): Promise<number> {
    return this.storage.size
  }
}

/**
 * 存储适配器工厂
 */
export class StorageAdapterFactory {
  static createLocalStorage(prefix?: string): LocalStorageAdapter {
    return new LocalStorageAdapter(prefix)
  }

  static createSessionStorage(prefix?: string): SessionStorageAdapter {
    return new SessionStorageAdapter(prefix)
  }

  static createIndexedDB(
    dbName?: string,
    storeName?: string,
    version?: number
  ): IndexedDBAdapter {
    return new IndexedDBAdapter(dbName, storeName, version)
  }

  static createMemoryStorage(): MemoryStorageAdapter {
    return new MemoryStorageAdapter()
  }

  static createDefault(): StorageAdapterInterface {
    // 优先使用 IndexedDB，降级到 LocalStorage
    if (typeof indexedDB !== 'undefined') {
      return new IndexedDBAdapter()
    } else if (typeof localStorage !== 'undefined') {
      return new LocalStorageAdapter()
    } else {
      return new MemoryStorageAdapter()
    }
  }
}