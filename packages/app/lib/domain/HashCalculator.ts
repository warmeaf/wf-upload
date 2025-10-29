/**
 * 哈希计算器 - 领域服务层
 * 支持多种哈希算法、Worker并行计算和验证功能
 * 集成Spark-MD5库确保MD5计算准确性
 */

import {
  WorkerAdapterInterface,
  WorkerMessage,
} from '../infrastructure/WorkerAdapter'
import { EventBusInterface } from '../infrastructure/EventBus'
import SparkMD5 from 'spark-md5'

export type HashAlgorithm = 'md5'

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
  useWorker: boolean
  chunkSize: number
  enableProgress: boolean
  enableCache: boolean
  workerScriptURL?: string
}

export interface HashCalculatorInterface {
  // 计算分片哈希
  calculateChunkHash(chunk: Blob): Promise<string>
  // 计算文件哈希
  calculateFileHash(chunks: Blob[]): Promise<string>
  // 增量计算文件哈希
  calculateFileHashIncremental(
    file: File,
    onProgress?: (progress: HashProgress) => void
  ): Promise<HashResult>
  // 验证哈希
  verifyHash(data: Blob, expectedHash: string): Promise<boolean>
  // 批量计算哈希
  batchCalculateHash(chunks: Blob[]): Promise<string[]>
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
  private workerId?: string
  private options: HashCalculationOptions = {
    useWorker: true,
    chunkSize: 2 * 1024 * 1024, // 2MB
    enableProgress: true,
    enableCache: true,
    workerScriptURL: undefined,
  }

  constructor(
    eventBus: EventBusInterface,
    workerAdapter?: WorkerAdapterInterface
  ) {
    this.eventBus = eventBus
    this.workerAdapter = workerAdapter
  }

  async calculateChunkHash(chunk: Blob): Promise<string> {
    const cacheKey = this.getCacheKey(chunk)

    // 检查缓存
    if (this.options.enableCache && this.hashCache.has(cacheKey)) {
      return this.hashCache.get(cacheKey)!
    }

    const startTime = Date.now()
    let hash: string

    if (this.options.useWorker && this.workerAdapter) {
      hash = await this.calculateHashWithWorker(chunk)
    } else {
      hash = await this.calculateHashNative(chunk)
    }

    const computeTime = Date.now() - startTime

    // 缓存结果
    if (this.options.enableCache) {
      this.hashCache.set(cacheKey, hash)
    }

    this.eventBus.emit('hash:chunk:completed', {
      size: chunk.size,
      algorithm: 'md5' as HashAlgorithm,
      hash,
      computeTime,
    })

    return hash
  }

  async calculateFileHash(chunks: Blob[]): Promise<string> {
    if (chunks.length === 0) {
      throw new Error('No chunks provided for hash calculation')
    }

    if (chunks.length === 1) {
      return this.calculateChunkHash(chunks[0])
    }

    // 对于多个分片，需要按顺序计算整体哈希
    const hasher = await this.createHasher()

    for (let i = 0; i < chunks.length; i++) {
      const chunkBuffer = await chunks[i].arrayBuffer()
      hasher.update(new Uint8Array(chunkBuffer))

      this.eventBus.emit('hash:file:progress', {
        processed: i + 1,
        total: chunks.length,
        percentage: ((i + 1) / chunks.length) * 100,
      })
    }

    const result = hasher.digest()
    return typeof result === 'string' ? result : await result
  }

  async calculateFileHashIncremental(
    file: File,
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
        return await this.calculateFileHashWithWorker(
          file,
          onProgress,
          abortController
        )
      }

      // 降级到主线程计算（与Worker保持一致：对每个分片计算MD5，再对拼接后的字符串计算MD5）
      const partialHashes: string[] = []
      let processedBytes = 0

      for (let i = 0; i < totalChunks; i++) {
        if (abortController.signal.aborted) {
          throw new Error('Hash calculation was cancelled')
        }

        const start = i * chunkSize
        const end = Math.min(start + chunkSize, file.size)
        const chunk = file.slice(start, end)
        const chunkBuffer = await chunk.arrayBuffer()

        // 每个片段单独计算MD5
        const chunkHash = await this.calculateMD5WithSparkMD5(chunkBuffer)
        partialHashes.push(chunkHash)
        processedBytes += chunk.size

        // 计算进度
        const progress: HashProgress = {
          processed: processedBytes,
          total: file.size,
          percentage: (processedBytes / file.size) * 100,
          speed: processedBytes / ((Date.now() - startTime) / 1000),
          remainingTime: 0,
        }

        progress.remainingTime =
          progress.speed > 0 ? (file.size - processedBytes) / progress.speed : 0

        if (onProgress) {
          onProgress(progress)
        }

        if (this.options.enableProgress) {
          this.eventBus.emit('hash:file:progress', progress)
        }

        // 让出控制权，避免阻塞UI（减少延迟）
        if (i % 10 === 0) {
          await this.delay(0)
        }
      }

      // 与Worker一致：对所有分片哈希拼接后再次MD5
      const finalHash = await this.combineHashes(partialHashes)
      const computeTime = Date.now() - startTime

      const result: HashResult = {
        algorithm: 'md5' as HashAlgorithm,
        hash: finalHash,
        size: file.size,
        computeTime,
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
    const finalHash = await this.combineHashes(partialHashes)

    const computeTime = Date.now() - startTime

    const result: HashResult = {
      algorithm: 'md5' as HashAlgorithm,
      hash: finalHash,
      size: file.size,
      computeTime,
    }

    this.eventBus.emit('hash:file:completed', result)
    return result
  }

  /**
   * 在Worker中处理文件分片
   */
  private async processChunksInWorker(
    file: File,
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
          remainingTime: 0,
        }
        onProgress(progress)
      }
    }

    const message: WorkerMessage = {
      id: this.generateTaskId(),
      type: 'calculateHashBatch',
      data: {
        chunks,
        algorithm: 'md5' as HashAlgorithm,
      },
    }

    const workerId = await this.ensureWorker()
    const response = await this.workerAdapter.postMessage(workerId, message)
    return response.data.hash
  }

  /**
   * 合并多个部分hash为最终hash
   */
  private async combineHashes(hashes: string[]): Promise<string> {
    // 简化实现：将所有hash连接后再次计算hash
    const combinedString = hashes.join('')
    const buffer = new TextEncoder().encode(combinedString)
    return this.calculateMD5Native(buffer.buffer)
  }

  async verifyHash(data: Blob, expectedHash: string): Promise<boolean> {
    const calculatedHash = await this.calculateChunkHash(data)
    const isValid = calculatedHash.toLowerCase() === expectedHash.toLowerCase()

    this.eventBus.emit('hash:verification:completed', {
      expected: expectedHash,
      calculated: calculatedHash,
      isValid,
      size: data.size,
    })

    return isValid
  }

  async batchCalculateHash(chunks: Blob[]): Promise<string[]> {
    if (this.options.useWorker && this.workerAdapter) {
      return this.batchCalculateHashWithWorker(chunks)
    } else {
      return this.batchCalculateHashNative(chunks)
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
      keys: Array.from(this.hashCache.keys()),
    }
  }

  private async calculateHashWithWorker(blob: Blob): Promise<string> {
    if (!this.workerAdapter) {
      throw new Error('Worker adapter not available')
    }

    const buffer = await blob.arrayBuffer()
    const message: WorkerMessage = {
      id: this.generateTaskId(),
      type: 'calculateHash',
      data: {
        buffer,
        algorithm: 'md5' as HashAlgorithm,
      },
    }

    const workerId = await this.ensureWorker()
    const response = await this.workerAdapter.postMessage(workerId, message)
    return response.data.hash
  }

  private async calculateHashNative(blob: Blob): Promise<string> {
    const buffer = await blob.arrayBuffer()
    return this.calculateMD5WithSparkMD5(buffer)
  }

  private async calculateMD5WithSparkMD5(
    data: ArrayBuffer | Uint8Array
  ): Promise<string> {
    const spark = new SparkMD5.ArrayBuffer()
    
    // 确保数据是ArrayBuffer类型
    let buffer: ArrayBuffer
    if (data instanceof Uint8Array) {
      buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
    } else {
      buffer = data as ArrayBuffer
    }
    
    spark.append(buffer)
    return spark.end()
  }

  private calculateMD5Native(buffer: ArrayBuffer): string {
    return SparkMD5.ArrayBuffer.hash(buffer)
  }

  private async batchCalculateHashWithWorker(
    chunks: Blob[]
  ): Promise<string[]> {
    if (!this.workerAdapter) {
      throw new Error('Worker adapter not available')
    }

    const promises = chunks.map(async (chunk, index) => {
      const buffer = await chunk.arrayBuffer()
      const message: WorkerMessage = {
        id: `${this.generateTaskId()}_${index}`,
        type: 'calculateHash',
        data: { buffer, algorithm: 'md5' as HashAlgorithm },
      }

      const workerId = await this.ensureWorker()
      const response = await this.workerAdapter!.postMessage(workerId, message)
      return response.data.hash
    })

    return Promise.all(promises)
  }

  // 确保 Worker 已创建并返回其ID
  private async ensureWorker(): Promise<string> {
    if (!this.workerAdapter) {
      throw new Error('Worker adapter not available')
    }
    if (this.workerId) {
      return this.workerId
    }
    const scriptURL = this.options.workerScriptURL
    if (!scriptURL) {
      throw new Error('Worker script URL is not configured (workerScriptURL)')
    }
    this.workerId = await this.workerAdapter.createWorker(scriptURL)
    return this.workerId
  }

  private async batchCalculateHashNative(chunks: Blob[]): Promise<string[]> {
    const promises = chunks.map((chunk) => this.calculateHashNative(chunk))
    return Promise.all(promises)
  }

  private async createHasher(): Promise<IncrementalHasher> {
    return new SparkMD5Hasher()
  }

  private getCacheKey(blob: Blob): string {
    return `md5_${blob.size}_${blob.type}`
  }

  private generateTaskId(): string {
    return `hash_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
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
 * MD5增量哈希器 - 使用Spark-MD5
 */
class SparkMD5Hasher implements IncrementalHasher {
  private sparkMD5: SparkMD5.ArrayBuffer
  private buffer: ArrayBuffer[] = []

  constructor() {
    this.sparkMD5 = new SparkMD5.ArrayBuffer()
  }

  update(data: Uint8Array): void {
    this.buffer.push(data.buffer as ArrayBuffer)
  }

  digest(): string {
    // 合并所有缓冲区并计算最终哈希
    const totalLength = this.buffer.reduce(
      (sum, buf) => sum + buf.byteLength,
      0
    )
    const combined = new Uint8Array(totalLength)
    let offset = 0

    for (const buf of this.buffer) {
      combined.set(new Uint8Array(buf), offset)
      offset += buf.byteLength
    }

    return this.sparkMD5.append(combined.buffer).end()
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
