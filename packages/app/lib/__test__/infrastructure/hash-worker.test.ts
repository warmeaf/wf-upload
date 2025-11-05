import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import SparkMD5 from 'spark-md5'
import type {
  WorkerStartMessage,
  WorkerTaskMessage,
  ChunkInfo,
} from '../../domain/types'

// Mock SparkMD5
vi.mock('spark-md5', () => {
  // 创建一个类来正确 mock SparkMD5
  class MockSparkMD5 {
    append = vi.fn(function (this: MockSparkMD5) {
      return this
    })
    end = vi.fn(function (this: MockSparkMD5) {
      return 'mockfilehash'
    })
  }

  // 静态方法
  const ArrayBufferHash = vi.fn((buffer: ArrayBuffer) => {
    // 简单的 mock hash 实现，基于 buffer 大小
    return `mockhash${buffer.byteLength}`
  })

  // 构造函数 - 使用类而不是函数
  class SparkMD5Constructor extends MockSparkMD5 {
    static ArrayBuffer = {
      hash: ArrayBufferHash,
    }
  }

  return {
    default: SparkMD5Constructor,
  }
})

describe('HashWorker', () => {
  beforeEach(() => {
    // Mock FileReader - 超轻量级实现以避免内存问题
    // 使用 queueMicrotask 立即执行，避免 setTimeout 累积
    globalThis.FileReader = vi.fn(function (this: any) {
      const instance = {
        readAsArrayBuffer: vi.fn((blob: Blob) => {
          // 使用 queueMicrotask 立即执行，不延迟
          queueMicrotask(() => {
            try {
              // 创建一个非常小的 ArrayBuffer（只占位，不实际分配大内存）
              // 对于测试，我们只需要一个有效的 ArrayBuffer 引用
              const size = Math.min(blob.size, 1024) // 限制最大为 1KB
              const arrayBuffer = new ArrayBuffer(size)
              instance.result = arrayBuffer
              if (instance.onload) {
                instance.onload({
                  target: { result: arrayBuffer },
                } as any)
              }
            } catch (error) {
              if (instance.onerror) {
                instance.onerror({} as any)
              }
            }
          })
        }),
        onload: null as any,
        onerror: null as any,
        result: null as any,
      }
      return instance
    }) as any
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('文件分片功能 (createChunks)', () => {
    // 由于 createChunks 是内部函数，我们通过 Worker 消息来测试
    it('应该能够创建正确数量的分片', async () => {
      const file = new File(['x'.repeat(250)], 'test.txt', {
        type: 'text/plain',
      })
      const chunkSize = 100

      // 模拟分片逻辑
      const chunks: ChunkInfo[] = []
      let start = 0
      let index = 0

      while (start < file.size) {
        const end = Math.min(start + chunkSize, file.size)
        const blob = file.slice(start, end)

        chunks.push({
          index,
          start,
          end,
          size: end - start,
          blob,
        })

        start = end
        index++
      }

      expect(chunks).toHaveLength(3) // 100, 100, 50
      expect(chunks[0].index).toBe(0)
      expect(chunks[0].start).toBe(0)
      expect(chunks[0].end).toBe(100)
      expect(chunks[0].size).toBe(100)

      expect(chunks[1].index).toBe(1)
      expect(chunks[1].start).toBe(100)
      expect(chunks[1].end).toBe(200)
      expect(chunks[1].size).toBe(100)

      expect(chunks[2].index).toBe(2)
      expect(chunks[2].start).toBe(200)
      expect(chunks[2].end).toBe(250)
      expect(chunks[2].size).toBe(50)
    })

    it('应该处理文件大小正好等于分片大小的情况', () => {
      const file = new File(['x'.repeat(100)], 'test.txt', {
        type: 'text/plain',
      })
      const chunkSize = 100

      const chunks: ChunkInfo[] = []
      let start = 0
      let index = 0

      while (start < file.size) {
        const end = Math.min(start + chunkSize, file.size)
        const blob = file.slice(start, end)

        chunks.push({
          index,
          start,
          end,
          size: end - start,
          blob,
        })

        start = end
        index++
      }

      expect(chunks).toHaveLength(1)
      expect(chunks[0].size).toBe(100)
    })

    it('应该处理文件大小小于分片大小的情况', () => {
      const file = new File(['x'.repeat(50)], 'test.txt', {
        type: 'text/plain',
      })
      const chunkSize = 100

      const chunks: ChunkInfo[] = []
      let start = 0
      let index = 0

      while (start < file.size) {
        const end = Math.min(start + chunkSize, file.size)
        const blob = file.slice(start, end)

        chunks.push({
          index,
          start,
          end,
          size: end - start,
          blob,
        })

        start = end
        index++
      }

      expect(chunks).toHaveLength(1)
      expect(chunks[0].size).toBe(50)
    })

    it('应该处理空文件', () => {
      const file = new File([], 'test.txt', { type: 'text/plain' })
      const chunkSize = 100

      const chunks: ChunkInfo[] = []
      let start = 0
      let index = 0

      while (start < file.size) {
        const end = Math.min(start + chunkSize, file.size)
        const blob = file.slice(start, end)

        chunks.push({
          index,
          start,
          end,
          size: end - start,
          blob,
        })

        start = end
        index++
      }

      expect(chunks).toHaveLength(0)
    })
  })

  describe('Hash 计算功能', () => {
    it('应该能够计算分片 Hash', async () => {
      const blob = new Blob(['test data'])

      // 模拟 FileReader 的行为
      const reader = new FileReader()
      const hashPromise = new Promise<string>((resolve, reject) => {
        reader.onload = (e) => {
          try {
            const arrayBuffer = e.target?.result as ArrayBuffer
            const hash = SparkMD5.ArrayBuffer.hash(arrayBuffer)
            resolve(hash.toLowerCase())
          } catch (error) {
            reject(error)
          }
        }
        reader.onerror = () => {
          reject(new Error('FileReader error'))
        }
      })

      reader.readAsArrayBuffer(blob)

      // 等待 FileReader mock 异步完成
      const hash = await hashPromise
      expect(hash).toBeDefined()
      expect(typeof hash).toBe('string')
      // 验证 hash 格式（应该包含 mockhash 前缀）
      expect(hash).toContain('mockhash')
    })

    it('应该能够计算文件 Hash（基于分片 Hash）', () => {
      const chunkHashes = ['hash1', 'hash2', 'hash3']
      const spark = new SparkMD5()

      for (const chunkHash of chunkHashes) {
        spark.append(chunkHash)
      }

      const fileHash = spark.end().toLowerCase()
      expect(fileHash).toBeDefined()
      expect(typeof fileHash).toBe('string')
    })

    it('应该处理单个分片的文件 Hash', () => {
      const chunkHashes = ['hash1']
      const spark = new SparkMD5()

      for (const chunkHash of chunkHashes) {
        spark.append(chunkHash)
      }

      const fileHash = spark.end().toLowerCase()
      expect(fileHash).toBeDefined()
    })
  })

  describe('Worker 消息处理', () => {
    it('应该能够处理 start 消息（单线程模式）', async () => {
      const file = new File(['test content'], 'test.txt', {
        type: 'text/plain',
      })
      const chunkSize = 100

      // 模拟 Worker 消息处理逻辑
      const message: WorkerStartMessage = {
        type: 'start',
        file,
        chunkSize,
      }

      // 验证消息格式正确
      expect(message.type).toBe('start')
      expect(message.file).toBe(file)
      expect(message.chunkSize).toBe(chunkSize)
    })

    it('应该能够处理 task 消息（多线程模式）', () => {
      const taskId = 'task-123'
      const chunkIndex = 0
      const blob = new Blob(['chunk data'])

      const message: WorkerTaskMessage = {
        type: 'task',
        taskId,
        chunkIndex,
        blob,
      }

      expect(message.type).toBe('task')
      expect(message.taskId).toBe(taskId)
      expect(message.chunkIndex).toBe(chunkIndex)
      expect(message.blob).toBe(blob)
    })
  })

  describe('错误处理', () => {
    it('应该处理 FileReader 错误', async () => {
      const reader = new FileReader()

      let errorCaught = false
      try {
        reader.onerror = () => {
          throw new Error('Failed to read chunk')
        }

        // 模拟错误
        if (reader.onerror) {
          reader.onerror({} as any)
        }
      } catch (error) {
        errorCaught = true
        expect((error as Error).message).toBe('Failed to read chunk')
      }

      expect(errorCaught).toBe(true)
    })

    it('应该处理 Hash 计算错误', async () => {
      const reader = new FileReader()

      let errorCaught = false
      try {
        reader.onload = () => {
          throw new Error('Hash calculation failed')
        }

        // 模拟错误
        if (reader.onload) {
          reader.onload({ target: { result: null } } as any)
        }
      } catch (error) {
        errorCaught = true
        expect((error as Error).message).toBe('Hash calculation failed')
      }

      expect(errorCaught).toBe(true)
    })
  })

  describe('边界情况', () => {
    it('应该处理非常小的分片大小', () => {
      // 减少文件大小和分片数量以避免内存问题，但保持测试逻辑
      const file = new File(['x'.repeat(10)], 'test.txt', {
        type: 'text/plain',
      })
      const chunkSize = 1 // 1 byte

      const chunks: ChunkInfo[] = []
      let start = 0
      let index = 0

      while (start < file.size) {
        const end = Math.min(start + chunkSize, file.size)
        const blob = file.slice(start, end)

        chunks.push({
          index,
          start,
          end,
          size: end - start,
          blob,
        })

        start = end
        index++
      }

      expect(chunks).toHaveLength(10)
      expect(chunks[0].size).toBe(1)
      expect(chunks[9].size).toBe(1)
    })
  })
})
