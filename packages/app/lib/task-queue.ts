/**
 * 任务队列
 * 管理分片任务的分配，实现FIFO队列
 */

import type { ChunkInfo } from './types'

export interface Task {
  taskId: string
  chunk: ChunkInfo
}

export class TaskQueue {
  private queue: Task[] = []
  private chunks: Map<number, ChunkInfo> = new Map()

  constructor(chunks: ChunkInfo[]) {
    // 初始化队列，为每个chunk创建任务
    chunks.forEach((chunk) => {
      const task: Task = {
        taskId: `task-${chunk.index}-${Date.now()}-${Math.random()}`,
        chunk,
      }
      this.queue.push(task)
      this.chunks.set(chunk.index, chunk)
    })
  }

  /**
   * 从队列中取出下一个任务
   */
  dequeue(): Task | null {
    return this.queue.shift() || null
  }

  /**
   * 根据索引获取chunk信息
   */
  getChunkByIndex(index: number): ChunkInfo | undefined {
    return this.chunks.get(index)
  }

  /**
   * 清空队列
   */
  clear(): void {
    this.queue = []
    this.chunks.clear()
  }

  /**
   * 获取队列长度
   */
  get length(): number {
    return this.queue.length
  }
}

