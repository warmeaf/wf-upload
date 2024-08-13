export type HashType = 'file' | 'chunk';
export interface BaseHeader {
  'upload-file-token': string;
}
export interface PatchHashHeader extends BaseHeader {
  'upload-file-hash': string;
  'upload-file-type': HashType;
}

export interface Chunk {
  blob: Blob; // 分片的二进制数据
  start: number; // 分片的起始位置
  end: number; // 分片的结束位置
  hash: string; // 分片的hash值
  index: number; // 分片在文件中的索引
}
