import { describe, it, expect, beforeEach } from 'vitest'
import { TaskQueue } from '../../core/task-queue'
import type { ChunkInfo } from '../../domain/types'

describe('TaskQueue', () => {
  let chunks: ChunkInfo[]

  beforeEach(() => {
    chunks = [
      {
        index: 0,
        start: 0,
        end: 100,
        size: 100,
        blob: new Blob(['chunk0']),
      },
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
  })

  describe('构造函数', () => {
    it('应该正确初始化队列', () => {
      const queue = new TaskQueue(chunks)
      expect(queue).toBeDefined()
      expect(queue.length).toBe(3)
    })

    it('应该为空数组创建空队列', () => {
      const queue = new TaskQueue([])
      expect(queue.length).toBe(0)
    })

    it('应该为每个chunk创建任务', () => {
      const queue = new TaskQueue(chunks)
      const task1 = queue.dequeue()
      const task2 = queue.dequeue()
      const task3 = queue.dequeue()

      expect(task1).toBeDefined()
      expect(task2).toBeDefined()
      expect(task3).toBeDefined()
      expect(task1?.chunk.index).toBe(0)
      expect(task2?.chunk.index).toBe(1)
      expect(task3?.chunk.index).toBe(2)
    })

    it('应该为每个任务生成唯一的taskId', () => {
      const queue = new TaskQueue(chunks)
      const task1 = queue.dequeue()
      const task2 = queue.dequeue()
      const task3 = queue.dequeue()

      expect(task1?.taskId).toBeDefined()
      expect(task2?.taskId).toBeDefined()
      expect(task3?.taskId).toBeDefined()
      expect(task1?.taskId).not.toBe(task2?.taskId)
      expect(task2?.taskId).not.toBe(task3?.taskId)
      expect(task1?.taskId).not.toBe(task3?.taskId)
    })

    it('应该正确保存chunk信息到Map中', () => {
      const queue = new TaskQueue(chunks)
      expect(queue.getChunkByIndex(0)).toBeDefined()
      expect(queue.getChunkByIndex(1)).toBeDefined()
      expect(queue.getChunkByIndex(2)).toBeDefined()
    })

    it('应该处理单个chunk', () => {
      const singleChunk: ChunkInfo[] = [
        {
          index: 0,
          start: 0,
          end: 100,
          size: 100,
          blob: new Blob(['single']),
        },
      ]
      const queue = new TaskQueue(singleChunk)
      expect(queue.length).toBe(1)
      const task = queue.dequeue()
      expect(task?.chunk.index).toBe(0)
    })

    it('应该处理大量chunks', () => {
      const manyChunks: ChunkInfo[] = Array.from({ length: 100 }, (_, i) => ({
        index: i,
        start: i * 100,
        end: (i + 1) * 100,
        size: 100,
        blob: new Blob([`chunk${i}`]),
      }))
      const queue = new TaskQueue(manyChunks)
      expect(queue.length).toBe(100)
    })
  })

  describe('dequeue', () => {
    it('应该按FIFO顺序取出任务', () => {
      const queue = new TaskQueue(chunks)
      const task1 = queue.dequeue()
      const task2 = queue.dequeue()
      const task3 = queue.dequeue()

      expect(task1?.chunk.index).toBe(0)
      expect(task2?.chunk.index).toBe(1)
      expect(task3?.chunk.index).toBe(2)
    })

    it('空队列应该返回null', () => {
      const queue = new TaskQueue([])
      expect(queue.dequeue()).toBeNull()
    })

    it('取出所有任务后应该返回null', () => {
      const queue = new TaskQueue(chunks)
      queue.dequeue()
      queue.dequeue()
      queue.dequeue()
      expect(queue.dequeue()).toBeNull()
    })

    it('应该正确更新队列长度', () => {
      const queue = new TaskQueue(chunks)
      expect(queue.length).toBe(3)
      queue.dequeue()
      expect(queue.length).toBe(2)
      queue.dequeue()
      expect(queue.length).toBe(1)
      queue.dequeue()
      expect(queue.length).toBe(0)
    })

    it('返回的任务应该包含正确的chunk信息', () => {
      const queue = new TaskQueue(chunks)
      const task = queue.dequeue()

      expect(task).not.toBeNull()
      expect(task?.chunk.index).toBe(0)
      expect(task?.chunk.start).toBe(0)
      expect(task?.chunk.end).toBe(100)
      expect(task?.chunk.size).toBe(100)
      expect(task?.chunk.blob).toBeInstanceOf(Blob)
    })

    it('返回的任务应该包含taskId', () => {
      const queue = new TaskQueue(chunks)
      const task = queue.dequeue()

      expect(task?.taskId).toBeDefined()
      expect(typeof task?.taskId).toBe('string')
      expect(task?.taskId).toMatch(/^task-\d+-\d+-[\d.]+$/)
    })
  })

  describe('getChunkByIndex', () => {
    it('应该返回存在的chunk', () => {
      const queue = new TaskQueue(chunks)
      const chunk0 = queue.getChunkByIndex(0)
      const chunk1 = queue.getChunkByIndex(1)
      const chunk2 = queue.getChunkByIndex(2)

      expect(chunk0).toBeDefined()
      expect(chunk0?.index).toBe(0)
      expect(chunk1).toBeDefined()
      expect(chunk1?.index).toBe(1)
      expect(chunk2).toBeDefined()
      expect(chunk2?.index).toBe(2)
    })

    it('不存在的索引应该返回undefined', () => {
      const queue = new TaskQueue(chunks)
      expect(queue.getChunkByIndex(999)).toBeUndefined()
      expect(queue.getChunkByIndex(-1)).toBeUndefined()
    })

    it('取出任务后仍然可以通过索引获取chunk', () => {
      const queue = new TaskQueue(chunks)
      queue.dequeue()
      queue.dequeue()

      // 即使任务被取出，chunk信息仍然保留在Map中
      expect(queue.getChunkByIndex(0)).toBeDefined()
      expect(queue.getChunkByIndex(1)).toBeDefined()
      expect(queue.getChunkByIndex(2)).toBeDefined()
    })

    it('应该返回chunk的完整信息', () => {
      const queue = new TaskQueue(chunks)
      const chunk = queue.getChunkByIndex(1)

      expect(chunk).toBeDefined()
      expect(chunk?.index).toBe(1)
      expect(chunk?.start).toBe(100)
      expect(chunk?.end).toBe(200)
      expect(chunk?.size).toBe(100)
      expect(chunk?.blob).toBeInstanceOf(Blob)
    })
  })

  describe('clear', () => {
    it('应该清空队列', () => {
      const queue = new TaskQueue(chunks)
      expect(queue.length).toBe(3)
      queue.clear()
      expect(queue.length).toBe(0)
    })

    it('清空后dequeue应该返回null', () => {
      const queue = new TaskQueue(chunks)
      queue.clear()
      expect(queue.dequeue()).toBeNull()
    })

    it('应该清空chunks Map', () => {
      const queue = new TaskQueue(chunks)
      expect(queue.getChunkByIndex(0)).toBeDefined()
      queue.clear()
      expect(queue.getChunkByIndex(0)).toBeUndefined()
    })

    it('清空后可以重新添加数据', () => {
      const queue = new TaskQueue(chunks)
      queue.clear()
      const newChunks: ChunkInfo[] = [
        {
          index: 0,
          start: 0,
          end: 50,
          size: 50,
          blob: new Blob(['new']),
        },
      ]
      const newQueue = new TaskQueue(newChunks)
      expect(newQueue.length).toBe(1)
    })
  })

  describe('length', () => {
    it('应该返回队列的当前长度', () => {
      const queue = new TaskQueue(chunks)
      expect(queue.length).toBe(3)
    })

    it('空队列应该返回0', () => {
      const queue = new TaskQueue([])
      expect(queue.length).toBe(0)
    })

    it('取出任务后长度应该减少', () => {
      const queue = new TaskQueue(chunks)
      expect(queue.length).toBe(3)
      queue.dequeue()
      expect(queue.length).toBe(2)
      queue.dequeue()
      expect(queue.length).toBe(1)
    })

    it('清空后长度应该为0', () => {
      const queue = new TaskQueue(chunks)
      queue.clear()
      expect(queue.length).toBe(0)
    })
  })

  describe('边界情况', () => {
    it('应该处理包含相同索引的chunks（后一个覆盖前一个）', () => {
      const duplicateChunks: ChunkInfo[] = [
        {
          index: 0,
          start: 0,
          end: 100,
          size: 100,
          blob: new Blob(['first']),
        },
        {
          index: 0,
          start: 0,
          end: 200,
          size: 200,
          blob: new Blob(['second']),
        },
      ]
      const queue = new TaskQueue(duplicateChunks)
      expect(queue.length).toBe(2) // 队列中有两个任务
      expect(queue.getChunkByIndex(0)?.size).toBe(200) // Map中保存的是最后一个
    })

    it('应该处理不连续的索引', () => {
      const sparseChunks: ChunkInfo[] = [
        {
          index: 0,
          start: 0,
          end: 100,
          size: 100,
          blob: new Blob(['chunk0']),
        },
        {
          index: 5,
          start: 500,
          end: 600,
          size: 100,
          blob: new Blob(['chunk5']),
        },
        {
          index: 10,
          start: 1000,
          end: 1100,
          size: 100,
          blob: new Blob(['chunk10']),
        },
      ]
      const queue = new TaskQueue(sparseChunks)
      expect(queue.length).toBe(3)
      expect(queue.getChunkByIndex(0)).toBeDefined()
      expect(queue.getChunkByIndex(5)).toBeDefined()
      expect(queue.getChunkByIndex(10)).toBeDefined()
      expect(queue.getChunkByIndex(1)).toBeUndefined()
    })

    it('应该正确处理taskId格式', () => {
      const queue = new TaskQueue(chunks)
      const task = queue.dequeue()
      // taskId格式: task-{index}-{timestamp}-{random}
      const parts = task?.taskId.split('-')
      expect(parts?.[0]).toBe('task')
      expect(parts?.[1]).toBe('0') // chunk index
      expect(parts?.[2]).toBeDefined() // timestamp
      expect(parts?.[3]).toBeDefined() // random number
    })

    it('应该保持chunk对象的引用', () => {
      const queue = new TaskQueue(chunks)
      const originalChunk = chunks[0]
      const retrievedChunk = queue.getChunkByIndex(0)
      const dequeuedTask = queue.dequeue()

      // 应该返回相同的chunk对象
      expect(retrievedChunk).toBe(originalChunk)
      expect(dequeuedTask?.chunk).toBe(originalChunk)
    })
  })
})
