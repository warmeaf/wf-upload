export interface Chunk {
  blob: Blob; // 分片的二进制数据
  start: number; // 分片的起始位置
  end: number; // 分片的结束位置
  hash: string; // 分片的hash值
  index: number; // 分片在文件中的索引
}

// 分片的相关事件
// chunks: 一部分分片产生了
// wholeHash: 整个文件的hash计算完成
// drain: 所有分片处理完成
export type ChunkSplitorEvents = "chunks" | "wholeHash" | "drain";
