/**
 * Worker适配器 - 基础设施层
 * 管理Web Worker线程池和消息通信
 */

export interface WorkerMessage {
  id: string
  type: string
  data?: any
}

export interface WorkerResponse {
  id: string
  type: string
  data?: any
  error?: string
}

export type MessageCallback = (response: WorkerResponse) => void

export interface WorkerInstance {
  id: string
  worker: Worker
  busy: boolean
  createdAt: number
}

export interface WorkerAdapterInterface {
  // 创建Worker
  createWorker(script: string): Promise<string>
  // 发送消息
  postMessage(workerId: string, message: WorkerMessage): Promise<WorkerResponse>
  // 监听消息
  onMessage(workerId: string, callback: MessageCallback): void
  // 销毁Worker
  destroyWorker(workerId: string): void
  // 销毁所有Worker
  destroyAll(): void
  // 获取Worker状态
  getWorkerStatus(workerId: string): WorkerInstance | undefined
  // 获取所有Worker状态
  getAllWorkerStatus(): WorkerInstance[]
}

export class WorkerAdapter implements WorkerAdapterInterface {
  private workers: Map<string, WorkerInstance> = new Map()
  private messageCallbacks: Map<string, Set<MessageCallback>> = new Map()
  private pendingMessages: Map<string, { resolve: Function; reject: Function }> = new Map()
  private maxWorkers: number
  private workerTimeout: number

  constructor(maxWorkers: number = navigator.hardwareConcurrency || 4, workerTimeout: number = 30000) {
    this.maxWorkers = maxWorkers
    this.workerTimeout = workerTimeout
  }

  async createWorker(script: string): Promise<string> {
    // 检查是否超过最大Worker数量
    if (this.workers.size >= this.maxWorkers) {
      throw new Error(`Maximum number of workers (${this.maxWorkers}) exceeded`)
    }

    const workerId = this.generateWorkerId()
    
    try {
      let worker: Worker

      // 支持多种Worker创建方式
      if (script.startsWith('http') || script.startsWith('/')) {
        // URL方式
        worker = new Worker(script)
      } else if (script.includes('function') || script.includes('=>')) {
        // 内联脚本方式
        const blob = new Blob([script], { type: 'application/javascript' })
        const url = URL.createObjectURL(blob)
        worker = new Worker(url)
      } else {
        // 假设是模块路径
        worker = new Worker(script, { type: 'module' })
      }

      const workerInstance: WorkerInstance = {
        id: workerId,
        worker,
        busy: false,
        createdAt: Date.now()
      }

      // 设置消息监听
      worker.onmessage = (event) => {
        this.handleWorkerMessage(workerId, event.data)
      }

      worker.onerror = (error) => {
        this.handleWorkerError(workerId, error)
      }

      this.workers.set(workerId, workerInstance)
      return workerId
    } catch (error) {
      throw new Error(`Failed to create worker: ${error}`)
    }
  }

  async postMessage(workerId: string, message: WorkerMessage): Promise<WorkerResponse> {
    const workerInstance = this.workers.get(workerId)
    if (!workerInstance) {
      throw new Error(`Worker with id "${workerId}" not found`)
    }

    return new Promise((resolve, reject) => {
      const messageId = message.id || this.generateMessageId()
      const messageWithId = { ...message, id: messageId }

      // 存储Promise的resolve和reject
      this.pendingMessages.set(messageId, { resolve, reject })

      // 设置超时
      const timeout = setTimeout(() => {
        this.pendingMessages.delete(messageId)
        reject(new Error(`Worker message timeout after ${this.workerTimeout}ms`))
      }, this.workerTimeout)

      // 发送消息
      try {
        workerInstance.worker.postMessage(messageWithId)
        workerInstance.busy = true
      } catch (error) {
        clearTimeout(timeout)
        this.pendingMessages.delete(messageId)
        reject(error)
      }
    })
  }

  onMessage(workerId: string, callback: MessageCallback): void {
    if (!this.messageCallbacks.has(workerId)) {
      this.messageCallbacks.set(workerId, new Set())
    }
    this.messageCallbacks.get(workerId)!.add(callback)
  }

  destroyWorker(workerId: string): void {
    const workerInstance = this.workers.get(workerId)
    if (workerInstance) {
      workerInstance.worker.terminate()
      this.workers.delete(workerId)
      this.messageCallbacks.delete(workerId)
      
      // 清理待处理的消息
      this.pendingMessages.forEach((pending, messageId) => {
        if (messageId.startsWith(workerId)) {
          pending.reject(new Error('Worker was destroyed'))
          this.pendingMessages.delete(messageId)
        }
      })
    }
  }

  destroyAll(): void {
    this.workers.forEach((_, workerId) => {
      this.destroyWorker(workerId)
    })
  }

  getWorkerStatus(workerId: string): WorkerInstance | undefined {
    return this.workers.get(workerId)
  }

  getAllWorkerStatus(): WorkerInstance[] {
    return Array.from(this.workers.values())
  }

  // 获取空闲的Worker
  getIdleWorker(): WorkerInstance | undefined {
    for (const worker of this.workers.values()) {
      if (!worker.busy) {
        return worker
      }
    }
    return undefined
  }

  // 获取Worker池统计信息
  getPoolStats(): {
    total: number
    busy: number
    idle: number
    maxWorkers: number
  } {
    const total = this.workers.size
    const busy = Array.from(this.workers.values()).filter(w => w.busy).length
    const idle = total - busy

    return {
      total,
      busy,
      idle,
      maxWorkers: this.maxWorkers
    }
  }

  private handleWorkerMessage(workerId: string, data: WorkerResponse): void {
    const workerInstance = this.workers.get(workerId)
    if (workerInstance) {
      workerInstance.busy = false
    }

    // 处理Promise响应
    if (data.id && this.pendingMessages.has(data.id)) {
      const pending = this.pendingMessages.get(data.id)!
      this.pendingMessages.delete(data.id)

      if (data.error) {
        pending.reject(new Error(data.error))
      } else {
        pending.resolve(data)
      }
    }

    // 触发回调
    const callbacks = this.messageCallbacks.get(workerId)
    if (callbacks) {
      callbacks.forEach(callback => {
        try {
          callback(data)
        } catch (error) {
          console.error(`Error in worker message callback:`, error)
        }
      })
    }
  }

  private handleWorkerError(workerId: string, error: ErrorEvent): void {
    console.error(`Worker ${workerId} error:`, error)
    
    const workerInstance = this.workers.get(workerId)
    if (workerInstance) {
      workerInstance.busy = false
    }

    // 拒绝所有待处理的消息
    this.pendingMessages.forEach((pending, messageId) => {
      if (messageId.startsWith(workerId)) {
        pending.reject(new Error(`Worker error: ${error.message}`))
        this.pendingMessages.delete(messageId)
      }
    })
  }

  private generateWorkerId(): string {
    return `worker_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  private generateMessageId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }
}

/**
 * Worker池管理器
 * 提供更高级的Worker管理功能
 */
export class WorkerPool {
  private adapter: WorkerAdapter
  private workerScript: string
  private poolSize: number

  constructor(
    workerScript: string,
    poolSize: number = navigator.hardwareConcurrency || 4
  ) {
    this.adapter = new WorkerAdapter(poolSize)
    this.workerScript = workerScript
    this.poolSize = poolSize
  }

  async initialize(): Promise<void> {
    const promises = Array.from({ length: this.poolSize }, () =>
      this.adapter.createWorker(this.workerScript)
    )

    await Promise.all(promises)
  }

  async execute<T>(message: Omit<WorkerMessage, 'id'>): Promise<T> {
    // 获取空闲的Worker
    const idleWorker = this.adapter.getIdleWorker()
    if (!idleWorker) {
      throw new Error('No idle workers available')
    }

    const response = await this.adapter.postMessage(idleWorker.id, {
      ...message,
      id: this.generateMessageId()
    })

    return response.data as T
  }

  async executeParallel<T>(messages: Omit<WorkerMessage, 'id'>[]): Promise<T[]> {
    const promises = messages.map(message => this.execute<T>(message))
    return Promise.all(promises)
  }

  destroy(): void {
    this.adapter.destroyAll()
  }

  getStats() {
    return this.adapter.getPoolStats()
  }

  private generateMessageId(): string {
    return `pool_msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }
}