import { EventEmitter } from "@wf-upload/utils";
import { ChunkSplitor } from "./ChunkSplitor";
import type { Chunk } from "./type";

export class MultiThreadSplitor extends ChunkSplitor {
  private workers: Worker[] = new Array(navigator.hardwareConcurrency || 4)
    .fill(0)
    .map(
      () =>
        new Worker(new URL("./SplitWorker.ts", import.meta.url), {
          type: "module",
        })
    );

  calcHash(chunks: Chunk[], emitter: EventEmitter<"chunks">): void {
    // 计算每个 worker 应处理的块数量
    const workerSize = Math.ceil(chunks.length / this.workers.length);
    // 将块分配给各个 worker
    for (let i = 0; i < this.workers.length; i++) {
      const worker = this.workers[i];

      // 计算当前 worker 处理的块的起始和结束索引
      const start = i * workerSize;
      const end = Math.min((i + 1) * workerSize, chunks.length);

      // 提取当前 worker 要处理的块子集
      const workerChunks = chunks.slice(start, end);

      // 将块发送给 worker 进行处理
      worker.postMessage(workerChunks);

      // 设置回调函数处理 worker 的响应
      worker.onmessage = (e) => {
        // 通过事件发射器发出处理后的块数据
        emitter.emit("chunks", e.data);
      };
    }
  }

  dispose(): void {
    this.workers.forEach((worker) => worker.terminate());
  }
}
