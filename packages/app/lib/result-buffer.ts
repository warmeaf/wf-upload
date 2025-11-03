/**
 * 结果缓冲区
 * 缓冲并行计算的结果，保证事件按顺序触发
 */

import SparkMD5 from 'spark-md5'
import type {
  ChunkInfo,
  ChunkHashedEvent,
  AllChunksHashedEvent,
  FileHashedEvent,
  EventEmitter,
} from './types'

interface ChunkResult {
  hash: string
  chunk: ChunkInfo
}

export class ResultBuffer {
  private results: Map<number, ChunkResult> = new Map()
  private nextExpectedIndex: number = 0
  private totalChunks: number
  private chunkHashes: string[] = []
  private eventEmitter: EventEmitter

  constructor(totalChunks: number, eventEmitter: EventEmitter) {
    this.totalChunks = totalChunks
    this.eventEmitter = eventEmitter
    this.chunkHashes = new Array(totalChunks)
  }

  /**
   * 添加计算结果
   */
  addResult(chunkIndex: number, hash: string, chunk: ChunkInfo): void {
    // 存储结果
    this.results.set(chunkIndex, { hash, chunk })
    // 存储hash用于文件hash计算
    this.chunkHashes[chunkIndex] = hash

    // 尝试按顺序输出结果
    this.tryFlushResults()
  }

  /**
   * 尝试按顺序输出结果
   */
  private tryFlushResults(): void {
    while (this.results.has(this.nextExpectedIndex)) {
      const result = this.results.get(this.nextExpectedIndex)!
      
      // 触发ChunkHashed事件
      const chunkHashedEvent: ChunkHashedEvent = {
        type: 'ChunkHashed',
        chunk: { ...result.chunk, hash: result.hash },
      }
      this.eventEmitter.emit(chunkHashedEvent)

      // 清理已输出的结果
      this.results.delete(this.nextExpectedIndex)
      this.nextExpectedIndex++

      // 检查是否全部完成
      if (this.nextExpectedIndex >= this.totalChunks) {
        this.emitAllChunksHashed()
        this.calculateAndEmitFileHash()
        break
      }
    }
  }

  /**
   * 触发AllChunksHashed事件
   */
  private emitAllChunksHashed(): void {
    const allChunksHashedEvent: AllChunksHashedEvent = {
      type: 'AllChunksHashed',
    }
    this.eventEmitter.emit(allChunksHashedEvent)
  }

  /**
   * 计算并触发FileHashed事件
   */
  private calculateAndEmitFileHash(): void {
    // 按索引顺序收集Hash
    const chunkHashes: string[] = []
    for (let i = 0; i < this.totalChunks; i++) {
      if (this.chunkHashes[i]) {
        chunkHashes.push(this.chunkHashes[i])
      }
    }

    // 使用SparkMD5增量计算文件Hash
    const spark = new SparkMD5()
    for (const hash of chunkHashes) {
      spark.append(hash)
    }

    const fileHash = spark.end().toLowerCase()

    // 触发FileHashed事件
    const fileHashedEvent: FileHashedEvent = {
      type: 'FileHashed',
      fileHash,
    }
    this.eventEmitter.emit(fileHashedEvent)
  }

  /**
   * 清空缓冲区
   */
  clear(): void {
    this.results.clear()
    this.nextExpectedIndex = 0
    this.chunkHashes = []
  }
}

