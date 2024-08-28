export interface BaseChunk {
  hash: string; // 分片的hash值
  index: number; // 分片在文件中的索引
}

export interface Chunk extends BaseChunk {
  blob: Blob; // 分片的二进制数据
  start: number; // 分片的起始位置
  end: number; // 分片的结束位置
}

export interface UploadChunk {
  hash: string; // 分片的hash值
  index: string; // 分片在文件中的索引
  blob: Blob; // 分片的二进制数据
  start: string; // 分片的起始位置
  end: string; // 分片的结束位置
  token: string;
}
