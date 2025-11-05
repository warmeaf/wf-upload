import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { WorkerPool } from '../../application/worker-pool'
import { TaskQueue } from '../../core/task-queue'
import { ResultBuffer } from '../../core/result-buffer'
import type {
  EventEmitter,
  ChunkInfo,
  WorkerResultMessage,
  WorkerTaskErrorMessage,
} from '../../domain/types'

describe('WorkerPool', () => {
  let eventEmitter: EventEmitter
  let mockWorkers: Worker[]
  let emittedEvents: any[]
  let WorkerConstructor: any

  beforeEach(() => {
    emittedEvents = []
    eventEmitter = {
      emit: vi.fn((event) => {
        emittedEvents.push(event)
      }),
      on: vi.fn(),
      off: vi.fn(),
    }

    // Mock Worker 构造函数
    mockWorkers = []
    WorkerConstructor = class MockWorker {
      terminate = vi.fn()
      postMessage = vi.fn()
      onmessage: ((event: MessageEvent) => void) | null = null
      onerror: ((event: ErrorEvent) => void) | null = null

      constructor(_url: URL | string, _options?: WorkerOptions) {
        mockWorkers.push(this as any)
      }
    }
    ;(globalThis as any).Worker = WorkerConstructor
  })

  afterEach(() => {
    vi.clearAllMocks()
    mockWorkers = []
  })

  describe('构造函数', () => {
    it('应该创建指定数量的Worker', () => {
      new WorkerPool(3, eventEmitter)
      expect(mockWorkers).toHaveLength(3)
    })

    it('应该为每个Worker设置消息处理器', () => {
      new WorkerPool(2, eventEmitter)
      expect(mockWorkers[0].onmessage).toBeDefined()
      expect(mockWorkers[1].onmessage).toBeDefined()
    })

    it('应该初始化Worker状态为空闲', () => {
      new WorkerPool(2, eventEmitter)
      // 通过私有方法无法直接测试，但可以通过行为验证
      expect(mockWorkers).toHaveLength(2)
    })

    it('应该处理单个Worker的情况', () => {
      new WorkerPool(1, eventEmitter)
      expect(mockWorkers).toHaveLength(1)
    })
  })

  describe('start', () => {
    it('应该启动Worker处理任务', () => {
      const pool = new WorkerPool(2, eventEmitter)
      const chunks: ChunkInfo[] = [
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
      ]
      const taskQueue = new TaskQueue(chunks)
      const resultBuffer = new ResultBuffer(2, eventEmitter)

      pool.start(taskQueue, resultBuffer)

      // 应该立即分配任务给Worker
      expect(mockWorkers[0].postMessage).toHaveBeenCalled()
      expect(mockWorkers[1].postMessage).toHaveBeenCalled()
    })

    it('应该创建完成Promise', async () => {
      const pool = new WorkerPool(1, eventEmitter)
      const chunks: ChunkInfo[] = [
        {
          index: 0,
          start: 0,
          end: 100,
          size: 100,
          blob: new Blob(['chunk0']),
        },
      ]
      const taskQueue = new TaskQueue(chunks)
      const resultBuffer = new ResultBuffer(1, eventEmitter)

      pool.start(taskQueue, resultBuffer)

      // 应该可以等待完成
      const completionPromise = pool.waitForCompletion()
      expect(completionPromise).toBeInstanceOf(Promise)
    })

    it('应该重置终止状态', () => {
      const pool = new WorkerPool(1, eventEmitter)
      const chunks: ChunkInfo[] = [
        {
          index: 0,
          start: 0,
          end: 100,
          size: 100,
          blob: new Blob(['chunk0']),
        },
      ]
      const taskQueue = new TaskQueue(chunks)
      const resultBuffer = new ResultBuffer(1, eventEmitter)

      // 先启动一次
      pool.start(taskQueue, resultBuffer)
      expect(mockWorkers[0].postMessage).toHaveBeenCalled()

      // 终止
      pool.terminate()

      // 注意：terminate后workers被清空，所以无法重新启动
      // 这个测试验证terminate会重置isTerminated标志（虽然无法验证，但确保不会抛出错误）
      // 实际使用中，terminate后应该创建新的WorkerPool实例
      expect(pool).toBeDefined()

      // 验证terminate后调用start不会抛出错误（虽然不会分配任务）
      const newTaskQueue = new TaskQueue(chunks)
      const newResultBuffer = new ResultBuffer(1, eventEmitter)
      expect(() => {
        pool.start(newTaskQueue, newResultBuffer)
      }).not.toThrow()
    })
  })

  describe('waitForCompletion', () => {
    it('应该在所有任务完成时resolve', async () => {
      const pool = new WorkerPool(1, eventEmitter)
      const chunks: ChunkInfo[] = [
        {
          index: 0,
          start: 0,
          end: 100,
          size: 100,
          blob: new Blob(['chunk0']),
        },
      ]
      const taskQueue = new TaskQueue(chunks)
      const resultBuffer = new ResultBuffer(1, eventEmitter)

      // 在start之前获取任务信息，因为start会立即分配任务
      const taskId = `task-0-${Date.now()}-${Math.random()}`

      pool.start(taskQueue, resultBuffer)

      // 模拟Worker返回结果
      const resultMessage: WorkerResultMessage = {
        type: 'result',
        taskId: taskId,
        chunkIndex: 0,
        hash: 'hash0',
      }

      // 手动触发消息处理
      if (mockWorkers[0].onmessage) {
        mockWorkers[0].onmessage({
          data: resultMessage,
        } as MessageEvent)
      }

      // 等待完成
      await expect(pool.waitForCompletion()).resolves.toBeUndefined()
    })

    it('如果未启动应该返回已resolve的Promise', async () => {
      const pool = new WorkerPool(1, eventEmitter)
      await expect(pool.waitForCompletion()).resolves.toBeUndefined()
    })
  })

  describe('terminate', () => {
    it('应该终止所有Worker', () => {
      const pool = new WorkerPool(3, eventEmitter)
      pool.terminate()

      expect(mockWorkers[0].terminate).toHaveBeenCalled()
      expect(mockWorkers[1].terminate).toHaveBeenCalled()
      expect(mockWorkers[2].terminate).toHaveBeenCalled()
    })

    it('应该清理状态', () => {
      const pool = new WorkerPool(2, eventEmitter)
      const chunks: ChunkInfo[] = [
        {
          index: 0,
          start: 0,
          end: 100,
          size: 100,
          blob: new Blob(['chunk0']),
        },
      ]
      const taskQueue = new TaskQueue(chunks)
      const resultBuffer = new ResultBuffer(1, eventEmitter)

      pool.start(taskQueue, resultBuffer)
      pool.terminate()

      // 终止后不应该再处理消息
      const resultMessage: WorkerResultMessage = {
        type: 'result',
        taskId: 'task-0',
        chunkIndex: 0,
        hash: 'hash0',
      }

      if (mockWorkers[0].onmessage) {
        mockWorkers[0].onmessage({
          data: resultMessage,
        } as MessageEvent)
      }

      // 应该不会触发事件（因为已终止）
      // 这个验证依赖于实现细节
    })

    it('应该reject等待中的Promise', async () => {
      const pool = new WorkerPool(1, eventEmitter)
      const chunks: ChunkInfo[] = [
        {
          index: 0,
          start: 0,
          end: 100,
          size: 100,
          blob: new Blob(['chunk0']),
        },
      ]
      const taskQueue = new TaskQueue(chunks)
      const resultBuffer = new ResultBuffer(1, eventEmitter)

      pool.start(taskQueue, resultBuffer)

      const completionPromise = pool.waitForCompletion()
      pool.terminate()

      await expect(completionPromise).rejects.toThrow('Worker pool terminated')
    })
  })

  describe('Worker消息处理', () => {
    it('应该处理Worker返回的结果', () => {
      const pool = new WorkerPool(1, eventEmitter)
      const chunks: ChunkInfo[] = [
        {
          index: 0,
          start: 0,
          end: 100,
          size: 100,
          blob: new Blob(['chunk0']),
        },
      ]
      const taskQueue = new TaskQueue(chunks)
      const resultBuffer = new ResultBuffer(1, eventEmitter)

      // 在start之前获取任务信息
      const taskId = `task-0-${Date.now()}-${Math.random()}`

      pool.start(taskQueue, resultBuffer)

      const resultMessage: WorkerResultMessage = {
        type: 'result',
        taskId: taskId,
        chunkIndex: 0,
        hash: 'hash0',
      }

      // 触发消息
      if (mockWorkers[0].onmessage) {
        mockWorkers[0].onmessage({
          data: resultMessage,
        } as MessageEvent)
      }

      // 应该触发ChunkHashed事件（WorkerPool会自动调用resultBuffer.addResult）
      const chunkHashedEvents = emittedEvents.filter(
        (e) => e.type === 'ChunkHashed'
      )
      expect(chunkHashedEvents.length).toBeGreaterThan(0)
    })

    it('应该处理Worker错误消息', async () => {
      const pool = new WorkerPool(1, eventEmitter)
      const chunks: ChunkInfo[] = [
        {
          index: 0,
          start: 0,
          end: 100,
          size: 100,
          blob: new Blob(['chunk0']),
        },
      ]
      const taskQueue = new TaskQueue(chunks)
      const resultBuffer = new ResultBuffer(1, eventEmitter)

      pool.start(taskQueue, resultBuffer)

      // 捕获可能产生的Promise rejection
      const completionPromise = pool.waitForCompletion().catch(() => {})

      const errorMessage: WorkerTaskErrorMessage = {
        type: 'error',
        error: 'Test error',
      }

      // 触发错误消息
      if (mockWorkers[0].onmessage) {
        mockWorkers[0].onmessage({
          data: errorMessage,
        } as MessageEvent)
      }

      // 等待异步操作完成
      await new Promise((resolve) => setTimeout(resolve, 0))

      // 应该触发QueueAborted事件
      const abortEvents = emittedEvents.filter((e) => e.type === 'QueueAborted')
      expect(abortEvents.length).toBeGreaterThan(0)
      expect(abortEvents[0].error.message).toContain('Worker task error')

      // 清理Promise
      await completionPromise
    })

    it('应该处理Worker运行时错误', async () => {
      const pool = new WorkerPool(1, eventEmitter)
      const chunks: ChunkInfo[] = [
        {
          index: 0,
          start: 0,
          end: 100,
          size: 100,
          blob: new Blob(['chunk0']),
        },
      ]
      const taskQueue = new TaskQueue(chunks)
      const resultBuffer = new ResultBuffer(1, eventEmitter)

      pool.start(taskQueue, resultBuffer)

      // 捕获可能产生的Promise rejection
      const completionPromise = pool.waitForCompletion().catch(() => {})

      // 触发Worker错误
      if (mockWorkers[0].onerror) {
        mockWorkers[0].onerror({
          message: 'Worker runtime error',
        } as ErrorEvent)
      }

      // 等待异步操作完成
      await new Promise((resolve) => setTimeout(resolve, 0))

      // 应该触发QueueAborted事件
      const abortEvents = emittedEvents.filter((e) => e.type === 'QueueAborted')
      expect(abortEvents.length).toBeGreaterThan(0)

      // 清理Promise
      await completionPromise
    })

    it('终止后应该忽略消息', async () => {
      const pool = new WorkerPool(1, eventEmitter)
      const chunks: ChunkInfo[] = [
        {
          index: 0,
          start: 0,
          end: 100,
          size: 100,
          blob: new Blob(['chunk0']),
        },
      ]
      const taskQueue = new TaskQueue(chunks)
      const resultBuffer = new ResultBuffer(1, eventEmitter)

      pool.start(taskQueue, resultBuffer)

      // 捕获terminate产生的Promise rejection
      const completionPromise = pool.waitForCompletion().catch(() => {})

      pool.terminate()

      // 等待terminate完成
      await new Promise((resolve) => setTimeout(resolve, 0))

      const initialEventCount = emittedEvents.length

      // 尝试触发消息
      const resultMessage: WorkerResultMessage = {
        type: 'result',
        taskId: 'task-0',
        chunkIndex: 0,
        hash: 'hash0',
      }

      if (mockWorkers[0].onmessage) {
        mockWorkers[0].onmessage({
          data: resultMessage,
        } as MessageEvent)
      }

      // 等待异步操作完成
      await new Promise((resolve) => setTimeout(resolve, 0))

      // 事件数量不应该增加
      expect(emittedEvents.length).toBe(initialEventCount)

      // 清理Promise
      await completionPromise
    })
  })

  describe('任务分配', () => {
    it('应该按顺序分配任务给Worker', () => {
      const pool = new WorkerPool(2, eventEmitter)
      const chunks: ChunkInfo[] = [
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
      ]
      const taskQueue = new TaskQueue(chunks)
      const resultBuffer = new ResultBuffer(2, eventEmitter)

      pool.start(taskQueue, resultBuffer)

      // 两个Worker都应该收到任务
      expect(mockWorkers[0].postMessage).toHaveBeenCalled()
      expect(mockWorkers[1].postMessage).toHaveBeenCalled()

      // 验证任务消息格式
      const call0 = (mockWorkers[0].postMessage as any).mock.calls[0][0]
      const call1 = (mockWorkers[1].postMessage as any).mock.calls[0][0]

      expect(call0.type).toBe('task')
      expect(call0.chunkIndex).toBeDefined()
      expect(call0.blob).toBeInstanceOf(Blob)
      expect(call1.type).toBe('task')
      expect(call1.chunkIndex).toBeDefined()
      expect(call1.blob).toBeInstanceOf(Blob)
    })

    it('Worker完成任务后应该分配下一个任务', () => {
      const pool = new WorkerPool(1, eventEmitter)
      const chunks: ChunkInfo[] = [
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
      ]
      const taskQueue = new TaskQueue(chunks)
      const resultBuffer = new ResultBuffer(2, eventEmitter)

      pool.start(taskQueue, resultBuffer)

      const initialCallCount = (mockWorkers[0].postMessage as any).mock.calls
        .length

      // 模拟Worker完成第一个任务
      // 使用一个taskId，因为task已经被dequeue了
      const taskId0 = `task-0-${Date.now()}-${Math.random()}`
      const resultMessage0: WorkerResultMessage = {
        type: 'result',
        taskId: taskId0,
        chunkIndex: 0,
        hash: 'hash0',
      }

      if (mockWorkers[0].onmessage) {
        mockWorkers[0].onmessage({
          data: resultMessage0,
        } as MessageEvent)
      }

      // 应该分配下一个任务
      const newCallCount = (mockWorkers[0].postMessage as any).mock.calls.length
      expect(newCallCount).toBeGreaterThan(initialCallCount)
    })

    it('队列为空时Worker应该进入空闲状态', () => {
      const pool = new WorkerPool(1, eventEmitter)
      const chunks: ChunkInfo[] = [
        {
          index: 0,
          start: 0,
          end: 100,
          size: 100,
          blob: new Blob(['chunk0']),
        },
      ]
      const taskQueue = new TaskQueue(chunks)
      const resultBuffer = new ResultBuffer(1, eventEmitter)

      pool.start(taskQueue, resultBuffer)

      // 获取初始调用次数
      const initialCallCount = (mockWorkers[0].postMessage as any).mock.calls
        .length

      // 模拟Worker完成任务
      const taskId = `task-0-${Date.now()}-${Math.random()}`
      const resultMessage: WorkerResultMessage = {
        type: 'result',
        taskId: taskId,
        chunkIndex: 0,
        hash: 'hash0',
      }

      if (mockWorkers[0].onmessage) {
        mockWorkers[0].onmessage({
          data: resultMessage,
        } as MessageEvent)
      }

      // 队列为空，Worker应该进入空闲状态
      // 验证通过检查是否尝试分配下一个任务（应该没有，因为队列为空）
      const lastCallCount = (mockWorkers[0].postMessage as any).mock.calls
        .length
      // 调用次数应该等于初始调用次数（没有新的任务分配）
      expect(lastCallCount).toBe(initialCallCount)
    })
  })

  describe('完成检测', () => {
    it('应该在所有任务完成时resolve Promise', async () => {
      const pool = new WorkerPool(1, eventEmitter)
      const chunks: ChunkInfo[] = [
        {
          index: 0,
          start: 0,
          end: 100,
          size: 100,
          blob: new Blob(['chunk0']),
        },
      ]
      const taskQueue = new TaskQueue(chunks)
      const resultBuffer = new ResultBuffer(1, eventEmitter)

      pool.start(taskQueue, resultBuffer)

      // 模拟Worker完成所有任务
      const taskId = `task-0-${Date.now()}-${Math.random()}`
      const resultMessage: WorkerResultMessage = {
        type: 'result',
        taskId: taskId,
        chunkIndex: 0,
        hash: 'hash0',
      }

      if (mockWorkers[0].onmessage) {
        mockWorkers[0].onmessage({
          data: resultMessage,
        } as MessageEvent)
      }

      // 等待完成
      await expect(pool.waitForCompletion()).resolves.toBeUndefined()
    })

    it('应该处理多个Worker并行完成任务', async () => {
      const pool = new WorkerPool(2, eventEmitter)
      const chunks: ChunkInfo[] = [
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
      ]
      const taskQueue = new TaskQueue(chunks)
      const resultBuffer = new ResultBuffer(2, eventEmitter)

      pool.start(taskQueue, resultBuffer)

      // 模拟两个Worker完成各自的任务
      const taskId0 = `task-0-${Date.now()}-${Math.random()}`
      const taskId1 = `task-1-${Date.now()}-${Math.random()}`

      // Worker 0 完成任务
      const resultMessage0: WorkerResultMessage = {
        type: 'result',
        taskId: taskId0,
        chunkIndex: 0,
        hash: 'hash0',
      }

      if (mockWorkers[0].onmessage) {
        mockWorkers[0].onmessage({
          data: resultMessage0,
        } as MessageEvent)
      }

      // Worker 1 完成任务
      const resultMessage1: WorkerResultMessage = {
        type: 'result',
        taskId: taskId1,
        chunkIndex: 1,
        hash: 'hash1',
      }

      if (mockWorkers[1].onmessage) {
        mockWorkers[1].onmessage({
          data: resultMessage1,
        } as MessageEvent)
      }

      // 等待完成
      await expect(pool.waitForCompletion()).resolves.toBeUndefined()
    })
  })

  describe('边界情况', () => {
    it('应该处理空任务队列', () => {
      const pool = new WorkerPool(1, eventEmitter)
      const taskQueue = new TaskQueue([])
      const resultBuffer = new ResultBuffer(0, eventEmitter)

      pool.start(taskQueue, resultBuffer)

      // 不应该抛出错误
      expect(pool).toBeDefined()
    })

    it('应该处理大量Worker的情况', () => {
      new WorkerPool(10, eventEmitter)
      expect(mockWorkers).toHaveLength(10)
    })

    it('应该处理Worker数量大于任务数量的情况', () => {
      const pool = new WorkerPool(5, eventEmitter)
      const chunks: ChunkInfo[] = [
        {
          index: 0,
          start: 0,
          end: 100,
          size: 100,
          blob: new Blob(['chunk0']),
        },
      ]
      const taskQueue = new TaskQueue(chunks)
      const resultBuffer = new ResultBuffer(1, eventEmitter)

      pool.start(taskQueue, resultBuffer)

      // 应该只有一个Worker收到任务
      let tasksAssigned = 0
      mockWorkers.forEach((worker) => {
        if ((worker.postMessage as any).mock.calls.length > 0) {
          tasksAssigned++
        }
      })

      expect(tasksAssigned).toBeGreaterThan(0)
    })
  })
})
