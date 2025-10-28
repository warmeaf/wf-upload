/**
 * 哈希计算器 - 领域服务层
 * 支持多种哈希算法、Worker并行计算和验证功能
 */

import { WorkerAdapterInterface, WorkerMessage } from '../infrastructure/WorkerAdapter'
import { EventBusInterface } from '../infrastructure/EventBus'

export type HashAlgorithm = 'md5' | 'sha1' | 'sha256' | 'sha512'

export interface HashResult {
  algorithm: HashAlgorithm
  hash: string
  size: number
  computeTime: number
}

export interface HashProgress {
  processed: number
  total: number
  percentage: number
  speed: number
  remainingTime: number
}

export interface HashCalculationOptions {
  algorithm: HashAlgorithm
  useWorker: boolean
  chunkSize: number
  enableProgress: boolean
  enableCache: boolean
}

export interface HashCalculatorInterface {
  // 计算分片哈希
  calculateChunkHash(chunk: Blob, algorithm?: HashAlgorithm): Promise<string>
  // 计算文件哈希
  calculateFileHash(chunks: Blob[], algorithm?: HashAlgorithm): Promise<string>
  // 增量计算文件哈希
  calculateFileHashIncremental(file: File, algorithm?: HashAlgorithm, onProgress?: (progress: HashProgress) => void): Promise<HashResult>
  // 验证哈希
  verifyHash(data: Blob, expectedHash: string, algorithm?: HashAlgorithm): Promise<boolean>
  // 批量计算哈希
  batchCalculateHash(chunks: Blob[], algorithm?: HashAlgorithm): Promise<string[]>
  // 设置选项
  setOptions(options: Partial<HashCalculationOptions>): void
  // 取消计算
  cancelCalculation(taskId: string): void
}

export class HashCalculator implements HashCalculatorInterface {
  private workerAdapter?: WorkerAdapterInterface
  private eventBus: EventBusInterface
  private hashCache: Map<string, string> = new Map()
  private activeTasks: Map<string, AbortController> = new Map()
  private options: HashCalculationOptions = {
    algorithm: 'md5',
    useWorker: true,
    chunkSize: 2 * 1024 * 1024, // 2MB
    enableProgress: true,
    enableCache: true
  }

  constructor(
    eventBus: EventBusInterface,
    workerAdapter?: WorkerAdapterInterface
  ) {
    this.eventBus = eventBus
    this.workerAdapter = workerAdapter
  }

  async calculateChunkHash(chunk: Blob, algorithm: HashAlgorithm = this.options.algorithm): Promise<string> {
    const cacheKey = this.getCacheKey(chunk, algorithm)
    
    // 检查缓存
    if (this.options.enableCache && this.hashCache.has(cacheKey)) {
      return this.hashCache.get(cacheKey)!
    }

    const startTime = Date.now()
    let hash: string

    if (this.options.useWorker && this.workerAdapter) {
      hash = await this.calculateHashWithWorker(chunk, algorithm)
    } else {
      hash = await this.calculateHashNative(chunk, algorithm)
    }

    const computeTime = Date.now() - startTime

    // 缓存结果
    if (this.options.enableCache) {
      this.hashCache.set(cacheKey, hash)
    }

    this.eventBus.emit('hash:chunk:completed', {
      size: chunk.size,
      algorithm,
      hash,
      computeTime
    })

    return hash
  }

  async calculateFileHash(chunks: Blob[], algorithm: HashAlgorithm = this.options.algorithm): Promise<string> {
    if (chunks.length === 0) {
      throw new Error('No chunks provided for hash calculation')
    }

    if (chunks.length === 1) {
      return this.calculateChunkHash(chunks[0], algorithm)
    }

    // 对于多个分片，需要按顺序计算整体哈希
    const hasher = await this.createHasher(algorithm)
    
    for (let i = 0; i < chunks.length; i++) {
      const chunkBuffer = await chunks[i].arrayBuffer()
      hasher.update(new Uint8Array(chunkBuffer))
      
      this.eventBus.emit('hash:file:progress', {
        processed: i + 1,
        total: chunks.length,
        percentage: ((i + 1) / chunks.length) * 100
      })
    }

    const result = hasher.digest()
    return typeof result === 'string' ? result : await result
  }

  async calculateFileHashIncremental(
    file: File,
    algorithm: HashAlgorithm = this.options.algorithm,
    onProgress?: (progress: HashProgress) => void
  ): Promise<HashResult> {
    const taskId = this.generateTaskId()
    const abortController = new AbortController()
    this.activeTasks.set(taskId, abortController)

    const startTime = Date.now()
    const chunkSize = this.options.chunkSize
    const totalChunks = Math.ceil(file.size / chunkSize)
    
    try {
      // 优先使用Worker进行并行计算
      if (this.options.useWorker && this.workerAdapter) {
        return await this.calculateFileHashWithWorker(file, algorithm, onProgress, abortController)
      }

      // 降级到主线程计算
      const hasher = await this.createHasher(algorithm)
      let processedBytes = 0

      for (let i = 0; i < totalChunks; i++) {
        if (abortController.signal.aborted) {
          throw new Error('Hash calculation was cancelled')
        }

        const start = i * chunkSize
        const end = Math.min(start + chunkSize, file.size)
        const chunk = file.slice(start, end)
        const chunkBuffer = await chunk.arrayBuffer()
        
        hasher.update(new Uint8Array(chunkBuffer))
        processedBytes += chunk.size

        // 计算进度
        const progress: HashProgress = {
          processed: processedBytes,
          total: file.size,
          percentage: (processedBytes / file.size) * 100,
          speed: processedBytes / ((Date.now() - startTime) / 1000),
          remainingTime: 0
        }
        
        progress.remainingTime = progress.speed > 0 
          ? (file.size - processedBytes) / progress.speed 
          : 0

        if (onProgress) {
          onProgress(progress)
        }

        if (this.options.enableProgress) {
          this.eventBus.emit('hash:file:progress', progress)
        }

        // 让出控制权，避免阻塞UI（减少延迟）
        if (i % 10 === 0) { // 每10个分片让出一次控制权
          await this.delay(0)
        }
      }

      const hashResult = hasher.digest()
      const hash = typeof hashResult === 'string' ? hashResult : await hashResult
      const computeTime = Date.now() - startTime

      const result: HashResult = {
        algorithm,
        hash,
        size: file.size,
        computeTime
      }

      this.eventBus.emit('hash:file:completed', result)
      return result

    } finally {
      this.activeTasks.delete(taskId)
    }
  }

  /**
   * 使用Worker进行文件hash计算
   */
  private async calculateFileHashWithWorker(
    file: File,
    algorithm: HashAlgorithm,
    onProgress?: (progress: HashProgress) => void,
    abortController?: AbortController
  ): Promise<HashResult> {
    const startTime = Date.now()
    const chunkSize = this.options.chunkSize
    const totalChunks = Math.ceil(file.size / chunkSize)
    
    // 将文件分成多个部分，每个Worker处理一部分
    const workerCount = Math.min(4, totalChunks) // 最多4个Worker
    const chunksPerWorker = Math.ceil(totalChunks / workerCount)
    
    const workerPromises: Promise<string>[] = []
    
    for (let workerIndex = 0; workerIndex < workerCount; workerIndex++) {
      const startChunk = workerIndex * chunksPerWorker
      const endChunk = Math.min(startChunk + chunksPerWorker, totalChunks)
      
      if (startChunk >= totalChunks) break
      
      const workerPromise = this.processChunksInWorker(
        file, 
        algorithm, 
        startChunk, 
        endChunk, 
        chunkSize,
        onProgress,
        abortController
      )
      
      workerPromises.push(workerPromise)
    }
    
    // 等待所有Worker完成
    const partialHashes = await Promise.all(workerPromises)
    
    // 合并所有部分的hash
    const finalHash = await this.combineHashes(partialHashes, algorithm)
    
    const computeTime = Date.now() - startTime
    
    const result: HashResult = {
      algorithm,
      hash: finalHash,
      size: file.size,
      computeTime
    }

    this.eventBus.emit('hash:file:completed', result)
    return result
  }

  /**
   * 在Worker中处理文件分片
   */
  private async processChunksInWorker(
    file: File,
    algorithm: HashAlgorithm,
    startChunk: number,
    endChunk: number,
    chunkSize: number,
    onProgress?: (progress: HashProgress) => void,
    abortController?: AbortController
  ): Promise<string> {
    if (!this.workerAdapter) {
      throw new Error('Worker adapter not available')
    }

    const chunks: ArrayBuffer[] = []
    
    for (let i = startChunk; i < endChunk; i++) {
      if (abortController?.signal.aborted) {
        throw new Error('Hash calculation was cancelled')
      }
      
      const start = i * chunkSize
      const end = Math.min(start + chunkSize, file.size)
      const chunk = file.slice(start, end)
      const buffer = await chunk.arrayBuffer()
      chunks.push(buffer)
      
      // 报告进度
      if (onProgress) {
        const processedBytes = (i + 1) * chunkSize
        const progress: HashProgress = {
          processed: Math.min(processedBytes, file.size),
          total: file.size,
          percentage: (Math.min(processedBytes, file.size) / file.size) * 100,
          speed: processedBytes / ((Date.now() - Date.now()) / 1000 || 1),
          remainingTime: 0
        }
        onProgress(progress)
      }
    }

    const message: WorkerMessage = {
      id: this.generateTaskId(),
      type: 'calculateHashBatch',
      data: {
        chunks,
        algorithm
      }
    }

    const response = await this.workerAdapter.postMessage('hash-worker', message)
    return response.data.hash
  }

  /**
   * 合并多个部分hash为最终hash
   */
  private async combineHashes(hashes: string[], algorithm: HashAlgorithm): Promise<string> {
    // 简化实现：将所有hash连接后再次计算hash
    const combinedString = hashes.join('')
    const buffer = new TextEncoder().encode(combinedString)
    
    let cryptoAlgorithm: string
    switch (algorithm) {
      case 'sha1':
        cryptoAlgorithm = 'SHA-1'
        break
      case 'sha256':
        cryptoAlgorithm = 'SHA-256'
        break
      case 'sha512':
        cryptoAlgorithm = 'SHA-512'
        break
      case 'md5':
      default:
        return this.calculateMD5Native(buffer.buffer)
    }

    const hashBuffer = await crypto.subtle.digest(cryptoAlgorithm, buffer)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
  }

  async verifyHash(data: Blob, expectedHash: string, algorithm: HashAlgorithm = this.options.algorithm): Promise<boolean> {
    const calculatedHash = await this.calculateChunkHash(data, algorithm)
    const isValid = calculatedHash.toLowerCase() === expectedHash.toLowerCase()
    
    this.eventBus.emit('hash:verification:completed', {
      expected: expectedHash,
      calculated: calculatedHash,
      isValid,
      size: data.size
    })

    return isValid
  }

  async batchCalculateHash(chunks: Blob[], algorithm: HashAlgorithm = this.options.algorithm): Promise<string[]> {
    if (this.options.useWorker && this.workerAdapter) {
      return this.batchCalculateHashWithWorker(chunks, algorithm)
    } else {
      return this.batchCalculateHashNative(chunks, algorithm)
    }
  }

  setOptions(options: Partial<HashCalculationOptions>): void {
    this.options = { ...this.options, ...options }
  }

  cancelCalculation(taskId: string): void {
    const controller = this.activeTasks.get(taskId)
    if (controller) {
      controller.abort()
      this.activeTasks.delete(taskId)
    }
  }

  // 清理缓存
  clearCache(): void {
    this.hashCache.clear()
  }

  // 获取缓存统计
  getCacheStats(): { size: number; keys: string[] } {
    return {
      size: this.hashCache.size,
      keys: Array.from(this.hashCache.keys())
    }
  }

  private async calculateHashWithWorker(blob: Blob, algorithm: HashAlgorithm): Promise<string> {
    if (!this.workerAdapter) {
      throw new Error('Worker adapter not available')
    }

    const buffer = await blob.arrayBuffer()
    const message: WorkerMessage = {
      id: this.generateTaskId(),
      type: 'calculateHash',
      data: {
        buffer,
        algorithm
      }
    }

    const response = await this.workerAdapter.postMessage('hash-worker', message)
    return response.data.hash
  }

  private async calculateHashNative(blob: Blob, algorithm: HashAlgorithm): Promise<string> {
    const buffer = await blob.arrayBuffer()
    
    let cryptoAlgorithm: string
    switch (algorithm) {
      case 'sha1':
        cryptoAlgorithm = 'SHA-1'
        break
      case 'sha256':
        cryptoAlgorithm = 'SHA-256'
        break
      case 'sha512':
        cryptoAlgorithm = 'SHA-512'
        break
      case 'md5':
      default:
        // 浏览器原生不支持MD5，需要使用第三方库或Worker
        return this.calculateMD5Native(buffer)
    }

    const hashBuffer = await crypto.subtle.digest(cryptoAlgorithm, buffer)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
  }

  private async batchCalculateHashWithWorker(chunks: Blob[], algorithm: HashAlgorithm): Promise<string[]> {
    if (!this.workerAdapter) {
      throw new Error('Worker adapter not available')
    }

    const promises = chunks.map(async (chunk, index) => {
      const buffer = await chunk.arrayBuffer()
      const message: WorkerMessage = {
        id: `${this.generateTaskId()}_${index}`,
        type: 'calculateHash',
        data: { buffer, algorithm }
      }
      
      const response = await this.workerAdapter!.postMessage('hash-worker', message)
      return response.data.hash
    })

    return Promise.all(promises)
  }

  private async batchCalculateHashNative(chunks: Blob[], algorithm: HashAlgorithm): Promise<string[]> {
    const promises = chunks.map(chunk => this.calculateHashNative(chunk, algorithm))
    return Promise.all(promises)
  }

  private async createHasher(algorithm: HashAlgorithm): Promise<IncrementalHasher> {
    switch (algorithm) {
      case 'md5':
        return new MD5Hasher()
      case 'sha1':
        return new SHA1Hasher()
      case 'sha256':
        return new SHA256Hasher()
      case 'sha512':
        return new SHA512Hasher()
      default:
        throw new Error(`Unsupported hash algorithm: ${algorithm}`)
    }
  }

  private async calculateMD5Native(buffer: ArrayBuffer): Promise<string> {
    // 这里需要实现MD5算法或使用第三方库
    // 为了简化，这里返回一个模拟的哈希值
    // 在实际项目中，应该使用 crypto-js 或其他MD5库
    const array = new Uint8Array(buffer)
    let hash = 0
    for (let i = 0; i < array.length; i++) {
      hash = ((hash << 5) - hash + array[i]) & 0xffffffff
    }
    return Math.abs(hash).toString(16).padStart(8, '0')
  }

  private getCacheKey(blob: Blob, algorithm: HashAlgorithm): string {
    return `${algorithm}_${blob.size}_${blob.type}`
  }

  private generateTaskId(): string {
    return `hash_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}

/**
 * 增量哈希计算器接口
 */
interface IncrementalHasher {
  update(data: Uint8Array): void
  digest(): string | Promise<string>
}

/**
 * MD5增量哈希器
 */
class MD5Hasher implements IncrementalHasher {
  private buffer: number[] = []
  private length: number = 0

  update(data: Uint8Array): void {
    // 简化的MD5实现，实际项目中应使用成熟的库
    for (let i = 0; i < data.length; i++) {
      this.buffer.push(data[i])
      this.length++
    }
  }

  digest(): string {
    // 简化的MD5摘要计算
    let hash = this.length
    for (let i = 0; i < this.buffer.length; i++) {
      hash = ((hash << 5) - hash + this.buffer[i]) & 0xffffffff
    }
    return Math.abs(hash).toString(16).padStart(8, '0')
  }
}

/**
 * SHA1增量哈希器
 */
class SHA1Hasher implements IncrementalHasher {
  private chunks: Uint8Array[] = []

  update(data: Uint8Array): void {
    this.chunks.push(data)
  }

  async digest(): Promise<string> {
    const totalLength = this.chunks.reduce((sum, chunk) => sum + chunk.length, 0)
    const combined = new Uint8Array(totalLength)
    let offset = 0
    
    for (const chunk of this.chunks) {
      combined.set(chunk, offset)
      offset += chunk.length
    }

    const hashBuffer = await crypto.subtle.digest('SHA-1', combined)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
  }
}

/**
 * SHA256增量哈希器
 */
class SHA256Hasher implements IncrementalHasher {
  private chunks: Uint8Array[] = []

  update(data: Uint8Array): void {
    this.chunks.push(data)
  }

  async digest(): Promise<string> {
    const totalLength = this.chunks.reduce((sum, chunk) => sum + chunk.length, 0)
    const combined = new Uint8Array(totalLength)
    let offset = 0
    
    for (const chunk of this.chunks) {
      combined.set(chunk, offset)
      offset += chunk.length
    }

    const hashBuffer = await crypto.subtle.digest('SHA-256', combined)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
  }
}

/**
 * SHA512增量哈希器
 */
class SHA512Hasher implements IncrementalHasher {
  private chunks: Uint8Array[] = []

  update(data: Uint8Array): void {
    this.chunks.push(data)
  }

  async digest(): Promise<string> {
    const totalLength = this.chunks.reduce((sum, chunk) => sum + chunk.length, 0)
    const combined = new Uint8Array(totalLength)
    let offset = 0
    
    for (const chunk of this.chunks) {
      combined.set(chunk, offset)
      offset += chunk.length
    }

    const hashBuffer = await crypto.subtle.digest('SHA-512', combined)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
  }
}

/**
 * 哈希计算器工厂
 */
export class HashCalculatorFactory {
  static create(
    eventBus: EventBusInterface,
    workerAdapter?: WorkerAdapterInterface,
    options?: Partial<HashCalculationOptions>
  ): HashCalculator {
    const calculator = new HashCalculator(eventBus, workerAdapter)
    if (options) {
      calculator.setOptions(options)
    }
    return calculator
  }

  static createWithWorker(
    eventBus: EventBusInterface,
    workerAdapter: WorkerAdapterInterface
  ): HashCalculator {
    return new HashCalculator(eventBus, workerAdapter)
  }

  static createNative(eventBus: EventBusInterface): HashCalculator {
    const calculator = new HashCalculator(eventBus)
    calculator.setOptions({ useWorker: false })
    return calculator
  }
}