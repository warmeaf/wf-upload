import { EventEmitter } from '@wf-upload/utils'
import { ChunkSplitor } from './ChunkSplitor'
import type { Chunk } from './type'

export class MultiThreadSplitor extends ChunkSplitor {
  private workers: Worker[] = new Array(navigator.hardwareConcurrency || 4)
    .fill(0)
    .map(
      () =>
        new Worker(new URL('./SplitWorker.ts', import.meta.url), {
          type: 'module',
        })
    )

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
        // console.log('分片 hash 计算完成', new Date().getTime())
        // 通过事件发射器发出处理后的块数据
        emitter.emit('chunks', e.data)
      }
    }
  }

  dispose(): void {
    this.workers.forEach((worker) => worker.terminate())
  }
}
