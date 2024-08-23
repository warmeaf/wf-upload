export interface Chunk {
  blob: Blob // 分片的二进制数据
  start: number // 分片的起始位置
  end: number // 分片的结束位置
  hash: string // 分片的hash值
  index: number // 分片在文件中的索引
}

export interface UploadChunk extends Chunk {
  token: string
}

// 分片的相关事件
// chunks: 一部分分片产生了
// wholeHash: 整个文件的hash计算完成
// drain: 所有分片处理完成
export type ChunkSplitorEvents = 'chunks' | 'wholeHash' | 'drain'

export interface CreateFile {
  name: string
  type: string
  size: number
  chunksLength: number
}

export interface RequestStrategy {
  // 文件创建请求，返回token
  createFile(file: CreateFile): Promise<{ status: string; token: string }>
  // 分片上传请求
  uploadChunk(chunk: UploadChunk): Promise<{ status: string }>
  // 文件合并请求，返回文件url
  mergeFile(
    token: string,
    hash: string
  ): Promise<{
    status: string
    url: string
  }>
  // hash校验请求
  patchHash<T extends 'file' | 'chunk'>(
    token: string,
    hash: string,
    type: T
  ): Promise<
    T extends 'chunk'
      ? { status: string; hasFile: boolean }
      : { status: string; hasFile: boolean; url: string }
  >
}
