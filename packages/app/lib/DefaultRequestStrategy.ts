import type { RequestStrategy, CreateFile, UploadChunk } from './type'

// 利用 fetch 实现请求
export class DefaultRequestStrategy implements RequestStrategy {
  // 文件创建请求，返回token
  async createFile(
    file: CreateFile
  ): Promise<{ status: string; token: string }> {
    // 发送文件创建请求
    // 这里应该实现实际的文件创建逻辑
    console.log(file)
    return {
      status: '',
      token: '',
    }
  }

  // 分片上传请求
  async uploadChunk(chunk: UploadChunk): Promise<{ status: string }> {
    // 发送分片上传请求
    // 这里应该实现实际的分片上传逻辑
    console.log('Uploading chunk:', chunk.index)
    return { status: 'ok' }
  }

  // 文件合并请求，返回文件url
  async mergeFile(token: string): Promise<{
    status: string
    url: string
  }> {
    // 发送文件合并请求
    // 这里应该实现实际的文件合并逻辑
    console.log('Merging file with token:', token)
    return {
      status: 'ok',
      url: '',
    }
  }

  // hash校验请求
  async patchHash<T extends 'file' | 'chunk'>(
    token: string,
    hash: string,
    type: T
  ): Promise<
    T extends 'file'
      ? { hasFile: boolean; rest: number[]; url: string }
      : { hasFile: boolean; rest: number[]; url: string }
  > {
    // 发送hash校验请求
    // 这里应该实现实际的hash校验逻辑
    console.log('Checking hash:', hash, 'for', type, token)
    if (type === 'file') {
      return { hasFile: false } as any
    } else {
      return { hasFile: false, rest: [], url: '' } as any
    }
  }
}
