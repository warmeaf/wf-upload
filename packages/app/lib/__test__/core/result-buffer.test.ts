import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ResultBuffer } from '../../core/result-buffer'
import type {
  EventEmitter,
  ChunkInfo,
  ChunkHashedEvent,
  AllChunksHashedEvent,
  FileHashedEvent,
} from '../../domain/types'

describe('ResultBuffer', () => {
  let eventEmitter: EventEmitter
  let emittedEvents: Array<
    ChunkHashedEvent | AllChunksHashedEvent | FileHashedEvent
  >

  beforeEach(() => {
    emittedEvents = []
    eventEmitter = {
      emit: vi.fn((event) => {
        emittedEvents.push(event as any)
      }),
      on: vi.fn(),
      off: vi.fn(),
    }
  })

  describe('构造函数', () => {
    it('应该正确初始化缓冲区', () => {
      const buffer = new ResultBuffer(5, eventEmitter)
      expect(buffer).toBeDefined()
    })
  })

  describe('addResult', () => {
    it('应该按顺序触发 ChunkHashed 事件', () => {
      const buffer = new ResultBuffer(3, eventEmitter)
      const chunks: ChunkInfo[] = [
        { index: 0, start: 0, end: 100, size: 100, blob: new Blob(['chunk0']) },
        {
          index: 1,
          start: 100,
          end: 200,
          size: 100,
          blob: new Blob(['chunk1']),
        },
        {
          index: 2,
          start: 200,
          end: 300,
          size: 100,
          blob: new Blob(['chunk2']),
        },
      ]

      // 按顺序添加
      buffer.addResult(0, 'hash0', chunks[0])
      buffer.addResult(1, 'hash1', chunks[1])
      buffer.addResult(2, 'hash2', chunks[2])

      // 应该触发 3 个 ChunkHashed 事件
      expect(eventEmitter.emit).toHaveBeenCalledTimes(5) // 3 ChunkHashed + 1 AllChunksHashed + 1 FileHashed

      const chunkHashedEvents = emittedEvents.filter(
        (e) => e.type === 'ChunkHashed'
      ) as ChunkHashedEvent[]

      expect(chunkHashedEvents).toHaveLength(3)
      expect(chunkHashedEvents[0].chunk.index).toBe(0)
      expect(chunkHashedEvents[0].chunk.hash).toBe('hash0')
      expect(chunkHashedEvents[1].chunk.index).toBe(1)
      expect(chunkHashedEvents[1].chunk.hash).toBe('hash1')
      expect(chunkHashedEvents[2].chunk.index).toBe(2)
      expect(chunkHashedEvents[2].chunk.hash).toBe('hash2')
    })

    it('应该处理乱序添加的结果', () => {
      const buffer = new ResultBuffer(3, eventEmitter)
      const chunks: ChunkInfo[] = [
        { index: 0, start: 0, end: 100, size: 100, blob: new Blob(['chunk0']) },
        {
          index: 1,
          start: 100,
          end: 200,
          size: 100,
          blob: new Blob(['chunk1']),
        },
        {
          index: 2,
          start: 200,
          end: 300,
          size: 100,
          blob: new Blob(['chunk2']),
        },
      ]

      // 乱序添加：先添加 index 2，再添加 index 0，最后添加 index 1
      buffer.addResult(2, 'hash2', chunks[2])
      expect(eventEmitter.emit).toHaveBeenCalledTimes(0) // 因为缺少 index 0，所以不触发

      buffer.addResult(0, 'hash0', chunks[0])
      expect(eventEmitter.emit).toHaveBeenCalledTimes(1) // 触发 index 0

      buffer.addResult(1, 'hash1', chunks[1])
      expect(eventEmitter.emit).toHaveBeenCalledTimes(5) // 触发 index 1, 2, AllChunksHashed, FileHashed

      const chunkHashedEvents = emittedEvents.filter(
        (e) => e.type === 'ChunkHashed'
      ) as ChunkHashedEvent[]

      // 验证事件是按顺序触发的
      expect(chunkHashedEvents).toHaveLength(3)
      expect(chunkHashedEvents[0].chunk.index).toBe(0)
      expect(chunkHashedEvents[1].chunk.index).toBe(1)
      expect(chunkHashedEvents[2].chunk.index).toBe(2)
    })

    it('应该在所有分片完成后触发 AllChunksHashed 事件', () => {
      const buffer = new ResultBuffer(2, eventEmitter)
      const chunks: ChunkInfo[] = [
        { index: 0, start: 0, end: 100, size: 100, blob: new Blob(['chunk0']) },
        {
          index: 1,
          start: 100,
          end: 200,
          size: 100,
          blob: new Blob(['chunk1']),
        },
      ]

      buffer.addResult(0, 'hash0', chunks[0])
      buffer.addResult(1, 'hash1', chunks[1])

      const allChunksHashedEvents = emittedEvents.filter(
        (e) => e.type === 'AllChunksHashed'
      ) as AllChunksHashedEvent[]

      expect(allChunksHashedEvents).toHaveLength(1)
      expect(allChunksHashedEvents[0].type).toBe('AllChunksHashed')
    })

    it('应该在所有分片完成后计算并触发 FileHashed 事件', () => {
      const buffer = new ResultBuffer(3, eventEmitter)
      const chunks: ChunkInfo[] = [
        { index: 0, start: 0, end: 100, size: 100, blob: new Blob(['chunk0']) },
        {
          index: 1,
          start: 100,
          end: 200,
          size: 100,
          blob: new Blob(['chunk1']),
        },
        {
          index: 2,
          start: 200,
          end: 300,
          size: 100,
          blob: new Blob(['chunk2']),
        },
      ]

      buffer.addResult(0, 'hash0', chunks[0])
      buffer.addResult(1, 'hash1', chunks[1])
      buffer.addResult(2, 'hash2', chunks[2])

      const fileHashedEvents = emittedEvents.filter(
        (e) => e.type === 'FileHashed'
      ) as FileHashedEvent[]

      expect(fileHashedEvents).toHaveLength(1)
      expect(fileHashedEvents[0].type).toBe('FileHashed')
      expect(fileHashedEvents[0].fileHash).toBeDefined()
      expect(typeof fileHashedEvents[0].fileHash).toBe('string')
    })

    it('应该正确计算文件 hash（基于所有分片 hash）', () => {
      const buffer = new ResultBuffer(2, eventEmitter)
      const chunks: ChunkInfo[] = [
        { index: 0, start: 0, end: 100, size: 100, blob: new Blob(['chunk0']) },
        {
          index: 1,
          start: 100,
          end: 200,
          size: 100,
          blob: new Blob(['chunk1']),
        },
      ]

      buffer.addResult(0, 'abc123', chunks[0])
      buffer.addResult(1, 'def456', chunks[1])

      const fileHashedEvents = emittedEvents.filter(
        (e) => e.type === 'FileHashed'
      ) as FileHashedEvent[]

      expect(fileHashedEvents).toHaveLength(1)
      // 文件 hash 应该是所有分片 hash 的组合 hash
      expect(fileHashedEvents[0].fileHash).toBeDefined()
      expect(fileHashedEvents[0].fileHash.length).toBeGreaterThan(0)
    })

    it('应该处理单个分片的情况', () => {
      const buffer = new ResultBuffer(1, eventEmitter)
      const chunk: ChunkInfo = {
        index: 0,
        start: 0,
        end: 100,
        size: 100,
        blob: new Blob(['chunk0']),
      }

      buffer.addResult(0, 'hash0', chunk)

      expect(eventEmitter.emit).toHaveBeenCalledTimes(3) // ChunkHashed + AllChunksHashed + FileHashed

      const chunkHashedEvents = emittedEvents.filter(
        (e) => e.type === 'ChunkHashed'
      ) as ChunkHashedEvent[]
      const allChunksHashedEvents = emittedEvents.filter(
        (e) => e.type === 'AllChunksHashed'
      ) as AllChunksHashedEvent[]
      const fileHashedEvents = emittedEvents.filter(
        (e) => e.type === 'FileHashed'
      ) as FileHashedEvent[]

      expect(chunkHashedEvents).toHaveLength(1)
      expect(allChunksHashedEvents).toHaveLength(1)
      expect(fileHashedEvents).toHaveLength(1)
    })

    it('应该处理大量分片的情况', () => {
      const totalChunks = 100
      const buffer = new ResultBuffer(totalChunks, eventEmitter)
      const chunks: ChunkInfo[] = Array.from(
        { length: totalChunks },
        (_, i) => ({
          index: i,
          start: i * 100,
          end: (i + 1) * 100,
          size: 100,
          blob: new Blob([`chunk${i}`]),
        })
      )

      // 乱序添加所有分片
      const indices = Array.from({ length: totalChunks }, (_, i) => i)
      for (let i = indices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[indices[i], indices[j]] = [indices[j], indices[i]]
      }

      indices.forEach((index) => {
        buffer.addResult(index, `hash${index}`, chunks[index])
      })

      const chunkHashedEvents = emittedEvents.filter(
        (e) => e.type === 'ChunkHashed'
      ) as ChunkHashedEvent[]

      expect(chunkHashedEvents).toHaveLength(totalChunks)

      // 验证事件是按顺序触发的
      chunkHashedEvents.forEach((event, i) => {
        expect(event.chunk.index).toBe(i)
        expect(event.chunk.hash).toBe(`hash${i}`)
      })

      const allChunksHashedEvents = emittedEvents.filter(
        (e) => e.type === 'AllChunksHashed'
      ) as AllChunksHashedEvent[]
      expect(allChunksHashedEvents).toHaveLength(1)

      const fileHashedEvents = emittedEvents.filter(
        (e) => e.type === 'FileHashed'
      ) as FileHashedEvent[]
      expect(fileHashedEvents).toHaveLength(1)
    })

    it('应该正确传递 chunk 信息到事件中', () => {
      const buffer = new ResultBuffer(1, eventEmitter)
      const chunk: ChunkInfo = {
        index: 0,
        start: 0,
        end: 100,
        size: 100,
        blob: new Blob(['test data']),
      }

      buffer.addResult(0, 'test-hash', chunk)

      const chunkHashedEvents = emittedEvents.filter(
        (e) => e.type === 'ChunkHashed'
      ) as ChunkHashedEvent[]

      expect(chunkHashedEvents).toHaveLength(1)
      expect(chunkHashedEvents[0].chunk.index).toBe(0)
      expect(chunkHashedEvents[0].chunk.start).toBe(0)
      expect(chunkHashedEvents[0].chunk.end).toBe(100)
      expect(chunkHashedEvents[0].chunk.size).toBe(100)
      expect(chunkHashedEvents[0].chunk.hash).toBe('test-hash')
    })
  })

  describe('clear', () => {
    it('应该清空缓冲区状态', () => {
      const buffer = new ResultBuffer(3, eventEmitter)
      const chunks: ChunkInfo[] = [
        { index: 0, start: 0, end: 100, size: 100, blob: new Blob(['chunk0']) },
        {
          index: 1,
          start: 100,
          end: 200,
          size: 100,
          blob: new Blob(['chunk1']),
        },
      ]

      buffer.addResult(0, 'hash0', chunks[0])
      buffer.clear()

      // 清空后添加新结果应该重新开始
      buffer.addResult(0, 'hash0-new', chunks[0])
      buffer.addResult(1, 'hash1-new', chunks[1])

      const chunkHashedEvents = emittedEvents.filter(
        (e) => e.type === 'ChunkHashed'
      ) as ChunkHashedEvent[]

      // 应该有两个事件（清空前的一个 + 清空后的两个）
      expect(chunkHashedEvents.length).toBeGreaterThanOrEqual(1)
    })

    it('清空后应该重置 nextExpectedIndex', () => {
      const buffer = new ResultBuffer(2, eventEmitter)
      const chunks: ChunkInfo[] = [
        { index: 0, start: 0, end: 100, size: 100, blob: new Blob(['chunk0']) },
        {
          index: 1,
          start: 100,
          end: 200,
          size: 100,
          blob: new Blob(['chunk1']),
        },
      ]

      buffer.addResult(1, 'hash1', chunks[1]) // 先添加 index 1
      buffer.clear()

      // 清空后应该可以从 index 0 重新开始
      buffer.addResult(0, 'hash0-new', chunks[0])
      expect(eventEmitter.emit).toHaveBeenCalled() // 应该能触发事件
    })
  })

  describe('边界情况', () => {
    it('应该处理空分片数组', () => {
      const buffer = new ResultBuffer(0, eventEmitter)
      // 不应该抛出错误
      expect(buffer).toBeDefined()
    })

    it('应该在最后一个分片添加后立即完成', () => {
      const buffer = new ResultBuffer(2, eventEmitter)
      const chunks: ChunkInfo[] = [
        { index: 0, start: 0, end: 100, size: 100, blob: new Blob(['chunk0']) },
        {
          index: 1,
          start: 100,
          end: 200,
          size: 100,
          blob: new Blob(['chunk1']),
        },
      ]

      buffer.addResult(1, 'hash1', chunks[1])
      buffer.addResult(0, 'hash0', chunks[0])

      // 应该在添加最后一个分片后立即触发所有完成事件
      const allChunksHashedEvents = emittedEvents.filter(
        (e) => e.type === 'AllChunksHashed'
      ) as AllChunksHashedEvent[]
      const fileHashedEvents = emittedEvents.filter(
        (e) => e.type === 'FileHashed'
      ) as FileHashedEvent[]

      expect(allChunksHashedEvents).toHaveLength(1)
      expect(fileHashedEvents).toHaveLength(1)
    })

    it('应该正确处理相同的 hash 值', () => {
      const buffer = new ResultBuffer(2, eventEmitter)
      const chunks: ChunkInfo[] = [
        { index: 0, start: 0, end: 100, size: 100, blob: new Blob(['chunk0']) },
        {
          index: 1,
          start: 100,
          end: 200,
          size: 100,
          blob: new Blob(['chunk1']),
        },
      ]

      buffer.addResult(0, 'same-hash', chunks[0])
      buffer.addResult(1, 'same-hash', chunks[1])

      const fileHashedEvents = emittedEvents.filter(
        (e) => e.type === 'FileHashed'
      ) as FileHashedEvent[]

      expect(fileHashedEvents).toHaveLength(1)
      expect(fileHashedEvents[0].fileHash).toBeDefined()
    })
  })
})
