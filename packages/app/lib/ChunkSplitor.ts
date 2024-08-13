import SparkMD5 from "spark-md5";
import { EventEmitter } from "@wf-upload/utils";
import { createChunk } from "./chunk";
import type { Chunk, ChunkSplitorEvents } from './type';

export abstract class ChunkSplitor extends EventEmitter<ChunkSplitorEvents> {
  protected chunkSize: number; // 分片大小（单位字节）
  protected file: File; // 待分片的文件
  protected hash?: string; // 整个文件的hash
  protected chunks: Chunk[]; // 分片列表
  private handleChunkCount = 0; // 已计算hash的分片数量
  private spark = new SparkMD5(); // 计算hash的工具
  private hasSplited = false; // 是否已经分片
  constructor(file: File, chunkSize: number = 1024 * 1024 * 5) {
    super();
    this.file = file;
    this.chunkSize = chunkSize;
    // 获取分片数组
    const chunkCount = Math.ceil(this.file.size / this.chunkSize);
    this.chunks = new Array(chunkCount)
      .fill(0)
      .map((_, index) => createChunk(this.file, index, this.chunkSize));
  }

  /**
   * split 方法用于分割文件为若干块，并计算每个块的哈希值，最后汇总为整个文件的哈希值
   * 同时需要确保按照分片顺序计算整个文件的 hash 值，否则会出现同一个文件 hash 值不一样的情况
   */
  split() {
    if (this.hasSplited) {
      return;
    }
    this.hasSplited = true;
    const emitter = new EventEmitter<"chunks">();
    const processedChunks: { [index: number]: Chunk } = {};
    let nextChunkToProcess = 0;

    const chunksHandler = (chunks: Chunk[]) => {
      this.emit("chunks", chunks);
      chunks.forEach((chunk) => {
        processedChunks[chunk.index] = chunk;
      });

      while (processedChunks[nextChunkToProcess]) {
        const chunk = processedChunks[nextChunkToProcess];
        this.spark.append(chunk.hash);
        delete processedChunks[nextChunkToProcess];
        nextChunkToProcess++;
      }

      this.handleChunkCount += chunks.length;
      if (this.handleChunkCount === this.chunks.length) {
        // All chunks processed
        emitter.off("chunks", chunksHandler);
        this.hash = this.spark.end();
        this.emit("wholeHash", this.hash);
        this.spark.destroy();
        this.emit("drain");
      }
    };
    emitter.on("chunks", chunksHandler);
    this.calcHash(this.chunks, emitter);
  }

  // 以下是旧版本代码
  // split() {
  //   if (this.hasSplited) {
  //     return
  //   }
  //   this.hasSplited = true
  //   const emitter = new EventEmitter<'chunks'>()
  //   const chunksHanlder = (chunks: Chunk[]) => {
  //     this.emit('chunks', chunks)
  //     chunks.forEach((chunk) => {
  //       this.spark.append(chunk.hash)
  //     })
  //     this.handleChunkCount += chunks.length
  //     if (this.handleChunkCount === this.chunks.length) {
  //       // 计算完成
  //       emitter.off('chunks', chunksHanlder)
  //       this.emit('wholeHash', this.spark.end())
  //       this.spark.destroy()
  //       this.emit('drain')
  //     }
  //   }
  //   emitter.on('chunks', chunksHanlder)
  //   this.calcHash(this.chunks, emitter)
  // }

  // 计算每一个分片的hash
  
  abstract calcHash(chunks: Chunk[], emitter: EventEmitter<"chunks">): void;

  // 分片完成后一些需要销毁的工作
  abstract dispose(): void;
}
