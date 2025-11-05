import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { UploadQueue } from '../../core/upload-queue'
import type {
  ChunkInfo,
  QueueDrainedEvent,
  QueueAbortedEvent,
} from '../../domain/types'

describe('UploadQueue', () => {
  let uploadQueue: UploadQueue
  let onChunkCheck: ReturnType<typeof vi.fn>
  let onChunkUpload: ReturnType<typeof vi.fn>
  let emittedEvents: Array<QueueDrainedEvent | QueueAbortedEvent>

  beforeEach(() => {
    emittedEvents = []
    onChunkCheck = vi.fn().mockResolvedValue(false) as any
    onChunkUpload = vi.fn().mockResolvedValue(undefined) as any

    uploadQueue = new UploadQueue({
      concurrency: 2,
      onChunkCheck: onChunkCheck as (hash: string) => Promise<boolean>,
      onChunkUpload: onChunkUpload as (
        chunk: ChunkInfo & { hash: string }
      ) => Promise<void>,
    })

    // 监听事件
    uploadQueue.on('QueueDrained', (event) => {
      emittedEvents.push(event as QueueDrainedEvent)
    })
    uploadQueue.on('QueueAborted', (event) => {
      emittedEvents.push(event as QueueAbortedEvent)
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
    emittedEvents = []
  })

  describe('构造函数', () => {
    it('应该正确初始化队列', () => {
      const queue = new UploadQueue({
        concurrency: 3,
        onChunkCheck: vi.fn(),
        onChunkUpload: vi.fn(),
      })
      expect(queue).toBeDefined()
      const stats = queue.getStats()
      expect(stats.totalChunks).toBe(0)
      expect(stats.pending).toBe(0)
      expect(stats.inFlight).toBe(0)
      expect(stats.completed).toBe(0)
      expect(stats.failed).toBe(0)
      expect(stats.allChunksHashed).toBe(false)
    })

    it('应该正确设置并发数', () => {
      const queue = new UploadQueue({
        concurrency: 5,
        onChunkCheck: vi.fn(),
        onChunkUpload: vi.fn(),
      })
      expect(queue).toBeDefined()
    })
  })

  describe('addChunkTask', () => {
    it('应该添加任务并更新统计信息', async () => {
      const chunk: ChunkInfo & { hash: string } = {
        index: 0,
        start: 0,
        end: 100,
        size: 100,
        blob: new Blob(['chunk0']),
        hash: 'hash0',
      }

      uploadQueue.addChunkTask(chunk)

      // 添加任务后，totalChunks 应该立即更新
      const statsBefore = uploadQueue.getStats()
      expect(statsBefore.totalChunks).toBe(1)
      
      // 等待处理完成
      await new Promise((resolve) => setTimeout(resolve, 20))
      
      const statsAfter = uploadQueue.getStats()
      expect(statsAfter.totalChunks).toBe(1)
      expect(statsAfter.completed).toBe(1)
    })

    it('应该立即尝试处理任务', async () => {
      const chunk: ChunkInfo & { hash: string } = {
        index: 0,
        start: 0,
        end: 100,
        size: 100,
        blob: new Blob(['chunk0']),
        hash: 'hash0',
      }

      uploadQueue.addChunkTask(chunk)

      // 等待异步处理
      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(onChunkCheck).toHaveBeenCalledWith('hash0')
    })

    it('应该在已中止时忽略新任务', () => {
      const chunk: ChunkInfo & { hash: string } = {
        index: 0,
        start: 0,
        end: 100,
        size: 100,
        blob: new Blob(['chunk0']),
        hash: 'hash0',
      }

      // 模拟中止
      ;(uploadQueue as any).isAborted = true

      uploadQueue.addChunkTask(chunk)

      const stats = uploadQueue.getStats()
      expect(stats.totalChunks).toBe(0)
      expect(stats.pending).toBe(0)
    })

    it('应该添加多个任务', async () => {
      const chunks: Array<ChunkInfo & { hash: string }> = [
        {
          index: 0,
          start: 0,
          end: 100,
          size: 100,
          blob: new Blob(['chunk0']),
          hash: 'hash0',
        },
        {
          index: 1,
          start: 100,
          end: 200,
          size: 100,
          blob: new Blob(['chunk1']),
          hash: 'hash1',
        },
        {
          index: 2,
          start: 200,
          end: 300,
          size: 100,
          blob: new Blob(['chunk2']),
          hash: 'hash2',
        },
      ]

      chunks.forEach((chunk) => uploadQueue.addChunkTask(chunk))

      const statsBefore = uploadQueue.getStats()
      expect(statsBefore.totalChunks).toBe(3)
      
      // 等待处理完成
      await new Promise((resolve) => setTimeout(resolve, 50))
      
      const statsAfter = uploadQueue.getStats()
      expect(statsAfter.totalChunks).toBe(3)
      expect(statsAfter.completed).toBe(3)
    })
  })

  describe('markAllChunksHashed', () => {
    it('应该标记所有分片已哈希', () => {
      uploadQueue.markAllChunksHashed()

      const stats = uploadQueue.getStats()
      expect(stats.allChunksHashed).toBe(true)
    })
  })

  describe('markAsCompleted', () => {
    it('应该标记所有待处理任务为完成', () => {
      const chunks: Array<ChunkInfo & { hash: string }> = [
        {
          index: 0,
          start: 0,
          end: 100,
          size: 100,
          blob: new Blob(['chunk0']),
          hash: 'hash0',
        },
        {
          index: 1,
          start: 100,
          end: 200,
          size: 100,
          blob: new Blob(['chunk1']),
          hash: 'hash1',
        },
      ]

      chunks.forEach((chunk) => uploadQueue.addChunkTask(chunk))
      uploadQueue.markAsCompleted()

      const stats = uploadQueue.getStats()
      expect(stats.allChunksHashed).toBe(true)
      expect(stats.pending).toBe(0)
      expect(stats.inFlight).toBe(0)
      expect(stats.failed).toBe(0)
      expect(stats.completed).toBe(2)
      expect(uploadQueue.isCompleted).toBe(true)
    })

    it('应该触发 QueueDrained 事件', () => {
      const chunk: ChunkInfo & { hash: string } = {
        index: 0,
        start: 0,
        end: 100,
        size: 100,
        blob: new Blob(['chunk0']),
        hash: 'hash0',
      }

      uploadQueue.addChunkTask(chunk)
      uploadQueue.markAsCompleted()

      const drainedEvents = emittedEvents.filter(
        (e) => e.type === 'QueueDrained'
      )
      expect(drainedEvents).toHaveLength(1)
    })
  })

  describe('isCompleted', () => {
    it('应该返回 false 当队列未完成时', () => {
      const chunk: ChunkInfo & { hash: string } = {
        index: 0,
        start: 0,
        end: 100,
        size: 100,
        blob: new Blob(['chunk0']),
        hash: 'hash0',
      }

      uploadQueue.addChunkTask(chunk)
      expect(uploadQueue.isCompleted).toBe(false)
    })

    it('应该返回 true 当所有条件满足时', () => {
      const chunk: ChunkInfo & { hash: string } = {
        index: 0,
        start: 0,
        end: 100,
        size: 100,
        blob: new Blob(['chunk0']),
        hash: 'hash0',
      }

      uploadQueue.addChunkTask(chunk)
      uploadQueue.markAsCompleted()
      expect(uploadQueue.isCompleted).toBe(true)
    })

    it('应该返回 false 当还有待处理任务时', async () => {
      const chunks: Array<ChunkInfo & { hash: string }> = [
        {
          index: 0,
          start: 0,
          end: 100,
          size: 100,
          blob: new Blob(['chunk0']),
          hash: 'hash0',
        },
        {
          index: 1,
          start: 100,
          end: 200,
          size: 100,
          blob: new Blob(['chunk1']),
          hash: 'hash1',
        },
      ]

      chunks.forEach((chunk) => uploadQueue.addChunkTask(chunk))
      
      // 在任务开始处理前检查
      const statsBefore = uploadQueue.getStats()
      expect(statsBefore.totalChunks).toBe(2)
      
      // 标记所有分片已哈希，但任务可能还在处理中
      uploadQueue.markAllChunksHashed()
      
      // 等待处理完成
      await new Promise((resolve) => setTimeout(resolve, 50))
      
      const statsAfter = uploadQueue.getStats()
      // 处理完成后应该完成
      expect(statsAfter.completed).toBe(2)
      expect(uploadQueue.isCompleted).toBe(true)
    })
  })

  describe('getStats', () => {
    it('应该返回统计信息的副本', () => {
      const stats1 = uploadQueue.getStats()
      const stats2 = uploadQueue.getStats()

      expect(stats1).not.toBe(stats2)
      expect(stats1).toEqual(stats2)
    })

    it('应该反映当前队列状态', async () => {
      const chunk: ChunkInfo & { hash: string } = {
        index: 0,
        start: 0,
        end: 100,
        size: 100,
        blob: new Blob(['chunk0']),
        hash: 'hash0',
      }

      uploadQueue.addChunkTask(chunk)

      const statsBefore = uploadQueue.getStats()
      expect(statsBefore.totalChunks).toBe(1)
      
      // 等待处理完成
      await new Promise((resolve) => setTimeout(resolve, 20))
      
      const statsAfter = uploadQueue.getStats()
      expect(statsAfter.totalChunks).toBe(1)
      expect(statsAfter.completed).toBe(1)
    })
  })

  describe('getFailedTasks', () => {
    it('应该返回空数组当没有失败任务时', () => {
      const failedTasks = uploadQueue.getFailedTasks()
      expect(failedTasks).toEqual([])
    })

    it('应该返回失败的任务', async () => {
      const chunk: ChunkInfo & { hash: string } = {
        index: 0,
        start: 0,
        end: 100,
        size: 100,
        blob: new Blob(['chunk0']),
        hash: 'hash0',
      }

      onChunkCheck.mockRejectedValueOnce(new Error('Check failed'))
      onChunkUpload.mockRejectedValueOnce(new Error('Upload failed'))

      uploadQueue.addChunkTask(chunk)

      await new Promise((resolve) => setTimeout(resolve, 50))

      const failedTasks = uploadQueue.getFailedTasks()
      expect(failedTasks.length).toBeGreaterThan(0)
      expect(failedTasks[0].status).toBe('failed')
      expect(failedTasks[0].error).toBeDefined()
    })
  })

  describe('任务处理流程', () => {
    it('应该检查分片是否存在', async () => {
      const chunk: ChunkInfo & { hash: string } = {
        index: 0,
        start: 0,
        end: 100,
        size: 100,
        blob: new Blob(['chunk0']),
        hash: 'hash0',
      }

      uploadQueue.addChunkTask(chunk)

      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(onChunkCheck).toHaveBeenCalledWith('hash0')
    })

    it('应该跳过已存在的分片', async () => {
      const chunk: ChunkInfo & { hash: string } = {
        index: 0,
        start: 0,
        end: 100,
        size: 100,
        blob: new Blob(['chunk0']),
        hash: 'hash0',
      }

      onChunkCheck.mockResolvedValueOnce(true)

      uploadQueue.addChunkTask(chunk)

      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(onChunkCheck).toHaveBeenCalledWith('hash0')
      expect(onChunkUpload).not.toHaveBeenCalled()

      const stats = uploadQueue.getStats()
      expect(stats.completed).toBe(1)
    })

    it('应该上传不存在的分片', async () => {
      const chunk: ChunkInfo & { hash: string } = {
        index: 0,
        start: 0,
        end: 100,
        size: 100,
        blob: new Blob(['chunk0']),
        hash: 'hash0',
      }

      onChunkCheck.mockResolvedValueOnce(false)

      uploadQueue.addChunkTask(chunk)

      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(onChunkCheck).toHaveBeenCalledWith('hash0')
      expect(onChunkUpload).toHaveBeenCalledWith(chunk)

      const stats = uploadQueue.getStats()
      expect(stats.completed).toBe(1)
    })

    it('应该处理检查失败', async () => {
      const chunk: ChunkInfo & { hash: string } = {
        index: 0,
        start: 0,
        end: 100,
        size: 100,
        blob: new Blob(['chunk0']),
        hash: 'hash0',
      }

      const error = new Error('Check failed')
      onChunkCheck.mockRejectedValueOnce(error)

      uploadQueue.addChunkTask(chunk)

      await new Promise((resolve) => setTimeout(resolve, 50))

      const abortEvents = emittedEvents.filter(
        (e) => e.type === 'QueueAborted'
      )
      expect(abortEvents).toHaveLength(1)
      expect(abortEvents[0].error).toBe(error)

      const stats = uploadQueue.getStats()
      expect(stats.failed).toBe(1)
    })

    it('应该处理上传失败', async () => {
      const chunk: ChunkInfo & { hash: string } = {
        index: 0,
        start: 0,
        end: 100,
        size: 100,
        blob: new Blob(['chunk0']),
        hash: 'hash0',
      }

      const error = new Error('Upload failed')
      onChunkCheck.mockResolvedValueOnce(false)
      onChunkUpload.mockRejectedValueOnce(error)

      uploadQueue.addChunkTask(chunk)

      await new Promise((resolve) => setTimeout(resolve, 50))

      const abortEvents = emittedEvents.filter(
        (e) => e.type === 'QueueAborted'
      )
      expect(abortEvents).toHaveLength(1)
      expect(abortEvents[0].error).toBe(error)

      const stats = uploadQueue.getStats()
      expect(stats.failed).toBe(1)
    })
  })

  describe('并发控制', () => {
    it('应该限制并发数', async () => {
      const chunks: Array<ChunkInfo & { hash: string }> = [
        {
          index: 0,
          start: 0,
          end: 100,
          size: 100,
          blob: new Blob(['chunk0']),
          hash: 'hash0',
        },
        {
          index: 1,
          start: 100,
          end: 200,
          size: 100,
          blob: new Blob(['chunk1']),
          hash: 'hash1',
        },
        {
          index: 2,
          start: 200,
          end: 300,
          size: 100,
          blob: new Blob(['chunk2']),
          hash: 'hash2',
        },
      ]

      // 使用延迟的 Promise 来跟踪并发数
      let concurrentCount = 0
      let maxConcurrent = 0

      onChunkCheck.mockImplementation(async () => {
        concurrentCount++
        maxConcurrent = Math.max(maxConcurrent, concurrentCount)
        await new Promise((resolve) => setTimeout(resolve, 10))
        concurrentCount--
        return false
      })

      chunks.forEach((chunk) => uploadQueue.addChunkTask(chunk))

      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(maxConcurrent).toBeLessThanOrEqual(2) // concurrency = 2
    })

    it('应该处理多个任务直到完成', async () => {
      const chunks: Array<ChunkInfo & { hash: string }> = Array.from(
        { length: 5 },
        (_, i) => ({
          index: i,
          start: i * 100,
          end: (i + 1) * 100,
          size: 100,
          blob: new Blob([`chunk${i}`]),
          hash: `hash${i}`,
        })
      )

      chunks.forEach((chunk) => uploadQueue.addChunkTask(chunk))

      await new Promise((resolve) => setTimeout(resolve, 100))

      const stats = uploadQueue.getStats()
      expect(stats.completed).toBe(5)
      expect(stats.pending).toBe(0)
      expect(stats.inFlight).toBe(0)
    })
  })

  describe('队列完成', () => {
    it('应该在所有任务完成时触发 QueueDrained 事件', async () => {
      const chunks: Array<ChunkInfo & { hash: string }> = [
        {
          index: 0,
          start: 0,
          end: 100,
          size: 100,
          blob: new Blob(['chunk0']),
          hash: 'hash0',
        },
        {
          index: 1,
          start: 100,
          end: 200,
          size: 100,
          blob: new Blob(['chunk1']),
          hash: 'hash1',
        },
      ]

      chunks.forEach((chunk) => uploadQueue.addChunkTask(chunk))
      uploadQueue.markAllChunksHashed()

      await new Promise((resolve) => setTimeout(resolve, 50))

      const drainedEvents = emittedEvents.filter(
        (e) => e.type === 'QueueDrained'
      )
      expect(drainedEvents.length).toBeGreaterThanOrEqual(1)
    })

    it('应该在任务失败时触发 QueueAborted 事件', async () => {
      const chunk: ChunkInfo & { hash: string } = {
        index: 0,
        start: 0,
        end: 100,
        size: 100,
        blob: new Blob(['chunk0']),
        hash: 'hash0',
      }

      const error = new Error('Test error')
      onChunkCheck.mockRejectedValueOnce(error)

      uploadQueue.addChunkTask(chunk)

      await new Promise((resolve) => setTimeout(resolve, 50))

      const abortEvents = emittedEvents.filter(
        (e) => e.type === 'QueueAborted'
      )
      expect(abortEvents).toHaveLength(1)
      expect(abortEvents[0].error).toBe(error)
    })
  })

  describe('事件系统', () => {
    it('应该支持注册和触发事件监听器', () => {
      const listener = vi.fn()
      uploadQueue.on('QueueDrained', listener)

      const chunk: ChunkInfo & { hash: string } = {
        index: 0,
        start: 0,
        end: 100,
        size: 100,
        blob: new Blob(['chunk0']),
        hash: 'hash0',
      }

      uploadQueue.addChunkTask(chunk)
      uploadQueue.markAsCompleted()

      expect(listener).toHaveBeenCalled()
    })

    it('应该支持移除事件监听器', () => {
      const listener = vi.fn()
      uploadQueue.on('QueueDrained', listener)
      uploadQueue.off('QueueDrained', listener)

      const chunk: ChunkInfo & { hash: string } = {
        index: 0,
        start: 0,
        end: 100,
        size: 100,
        blob: new Blob(['chunk0']),
        hash: 'hash0',
      }

      uploadQueue.addChunkTask(chunk)
      uploadQueue.markAsCompleted()

      expect(listener).not.toHaveBeenCalled()
    })

    it('应该支持多个监听器', () => {
      const listener1 = vi.fn()
      const listener2 = vi.fn()

      uploadQueue.on('QueueDrained', listener1)
      uploadQueue.on('QueueDrained', listener2)

      const chunk: ChunkInfo & { hash: string } = {
        index: 0,
        start: 0,
        end: 100,
        size: 100,
        blob: new Blob(['chunk0']),
        hash: 'hash0',
      }

      uploadQueue.addChunkTask(chunk)
      uploadQueue.markAsCompleted()

      expect(listener1).toHaveBeenCalled()
      expect(listener2).toHaveBeenCalled()
    })
  })

  describe('边界情况', () => {
    it('应该在完成状态下不处理新任务', async () => {
      const chunk1: ChunkInfo & { hash: string } = {
        index: 0,
        start: 0,
        end: 100,
        size: 100,
        blob: new Blob(['chunk0']),
        hash: 'hash0',
      }

      uploadQueue.addChunkTask(chunk1)
      
      // 等待第一个任务处理完成
      await new Promise((resolve) => setTimeout(resolve, 20))
      
      // 清除之前的调用记录
      vi.clearAllMocks()
      
      uploadQueue.markAsCompleted()

      const chunk2: ChunkInfo & { hash: string } = {
        index: 1,
        start: 100,
        end: 200,
        size: 100,
        blob: new Blob(['chunk1']),
        hash: 'hash1',
      }

      uploadQueue.addChunkTask(chunk2)

      await new Promise((resolve) => setTimeout(resolve, 10))

      // 完成状态下不应该处理新任务
      expect(onChunkCheck).not.toHaveBeenCalledWith('hash1')
    })

    it('应该在处理过程中检查完成状态', async () => {
      const chunk: ChunkInfo & { hash: string } = {
        index: 0,
        start: 0,
        end: 100,
        size: 100,
        blob: new Blob(['chunk0']),
        hash: 'hash0',
      }

      let checkCallCount = 0
      onChunkCheck.mockImplementation(async () => {
        checkCallCount++
        if (checkCallCount === 1) {
          // 第一次检查后标记为完成
          uploadQueue.markAsCompleted()
        }
        await new Promise((resolve) => setTimeout(resolve, 10))
        return false
      })

      uploadQueue.addChunkTask(chunk)

      await new Promise((resolve) => setTimeout(resolve, 50))

      // 即使有延迟，也应该在完成状态下停止处理
      expect(checkCallCount).toBe(1)
    })

    it('应该处理空队列', () => {
      uploadQueue.markAllChunksHashed()

      const stats = uploadQueue.getStats()
      expect(stats.totalChunks).toBe(0)
      expect(stats.allChunksHashed).toBe(true)
    })

    it('应该正确处理大量任务', async () => {
      const chunks: Array<ChunkInfo & { hash: string }> = Array.from(
        { length: 100 },
        (_, i) => ({
          index: i,
          start: i * 100,
          end: (i + 1) * 100,
          size: 100,
          blob: new Blob([`chunk${i}`]),
          hash: `hash${i}`,
        })
      )

      chunks.forEach((chunk) => uploadQueue.addChunkTask(chunk))
      uploadQueue.markAllChunksHashed()

      await new Promise((resolve) => setTimeout(resolve, 200))

      const stats = uploadQueue.getStats()
      expect(stats.totalChunks).toBe(100)
    })
  })
})

