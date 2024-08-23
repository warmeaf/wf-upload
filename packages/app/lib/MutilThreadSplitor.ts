import { EventEmitter } from '@wf-upload/utils'
import { SplitTemplate } from './SplitTemplate'
import type { Chunk } from './type'

export class MultiThreadSplitor extends SplitTemplate {
  private workers: Worker[] = new Array(navigator.hardwareConcurrency || 4)
    .fill(0)
    .map(
      () =>
        new Worker(new URL('./SplitWorker.ts', import.meta.url), {
          type: 'module',
        })
    )
  private isPaused: boolean = false
  private pausedChunks: Chunk[][] = []

  calcHash(chunks: Chunk[], emitter: EventEmitter<'chunks'>): void {
    // console.log('开始计算分片 hash', new Date().getTime())
    // 计算每个 worker 应处理的块数量
    let workerSize = Math.ceil(chunks.length / this.workers.length)
    // workerSize = workerSize > 30 ? 60 : workerSize
    // const workerSize = 10
    console.log(this.workers, workerSize)
    // 将块分配给各个 worker
    for (let i = 0; i < this.workers.length; i++) {
      const worker = this.workers[i]

      // 计算当前 worker 处理的块的起始和结束索引
      const start = i * workerSize
      const end = Math.min((i + 1) * workerSize, chunks.length)

      // 提取当前 worker 要处理的块子集
      const workerChunks = chunks.slice(start, end)

      // 将块发送给 worker 进行处理
      worker.postMessage(workerChunks)
      console.log('将块发送给 worker 进行处理', new Date().getTime())

      // 设置回调函数处理 worker 的响应
      worker.onmessage = (e) => {
        if (this.isPaused) {
          // If paused, store the chunks without emitting events
          this.pausedChunks.push(e.data)
        } else {
          // If not paused, emit the chunks event
          emitter.emit('chunks', e.data)
        }
      }
    }
  }

  pause(): void {
    this.isPaused = true
  }

  resume(emitter: EventEmitter<'chunks'>): void {
    this.isPaused = false
    for (const chunks of this.pausedChunks) {
      emitter.emit('chunks', chunks)
    }
    this.pausedChunks = []
  }

  dispose(): void {
    this.workers.forEach((worker) => worker.terminate())
  }
}
