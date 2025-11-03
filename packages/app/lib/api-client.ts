/**
 * API客户端
 * 处理与服务端的HTTP通信，严格遵循文档中的API契约
 */

import type {
  CreateFileRequest,
  CreateFileResponse,
  PatchHashRequest,
  PatchHashResponse,
  UploadChunkResponse,
  MergeFileRequest,
  MergeFileResponse,
  ChunkInfo,
  ChunkDto,
} from './types'

export class ApiClient {
  private baseUrl: string

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl
  }

  /**
   * 创建文件上传会话
   * POST /file/create
   */
  async createSession(request: CreateFileRequest): Promise<CreateFileResponse> {
    const response = await fetch(`${this.baseUrl}/file/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    })

    if (!response.ok) {
      throw new Error(
        `Failed to create session: ${response.status} ${response.statusText}`
      )
    }

    return await response.json()
  }

  /**
   * 检查分片Hash
   * POST /file/patchHash (isChunk: true)
   */
  async checkChunk(token: string, hash: string): Promise<boolean> {
    const request: PatchHashRequest = {
      token,
      hash,
      isChunk: true,
    }

    const response = await fetch(`${this.baseUrl}/file/patchHash`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    })

    if (!response.ok) {
      throw new Error(
        `Failed to check chunk: ${response.status} ${response.statusText}`
      )
    }

    const result: PatchHashResponse = await response.json()

    if (result.code !== 200) {
      throw new Error('Check chunk failed')
    }

    return result.exists
  }

  /**
   * 检查文件Hash（文件秒传）
   * POST /file/patchHash (isChunk: false)
   */
  async checkFile(token: string, hash: string): Promise<boolean> {
    const request: PatchHashRequest = {
      token,
      hash,
      isChunk: false,
    }

    const response = await fetch(`${this.baseUrl}/file/patchHash`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    })

    if (!response.ok) {
      throw new Error(
        `Failed to check file: ${response.status} ${response.statusText}`
      )
    }

    const result: PatchHashResponse = await response.json()

    if (result.code !== 200) {
      throw new Error('Check file failed')
    }

    return result.exists
  }

  /**
   * 上传分片
   * POST /file/uploadChunk
   */
  async uploadChunk(
    token: string,
    chunk: ChunkInfo & { hash: string }
  ): Promise<void> {
    const formData = new FormData()
    formData.append('chunk', chunk.blob)
    formData.append('token', token)
    formData.append('hash', chunk.hash)

    const response = await fetch(`${this.baseUrl}/file/uploadChunk`, {
      method: 'POST',
      body: formData,
    })

    if (!response.ok) {
      throw new Error(
        `Failed to upload chunk: ${response.status} ${response.statusText}`
      )
    }

    const result: UploadChunkResponse = await response.json()

    if (result.code !== 200 || !result.success) {
      throw new Error('Upload chunk failed')
    }
  }

  /**
   * 合并文件
   * POST /file/merge
   */
  async mergeFile(
    token: string,
    fileHash: string,
    fileName: string,
    chunks: ChunkDto[]
  ): Promise<string> {
    const request: MergeFileRequest = {
      token,
      fileHash,
      fileName,
      chunksLength: chunks.length,
      chunks,
    }

    const response = await fetch(`${this.baseUrl}/file/merge`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    })

    if (!response.ok) {
      throw new Error(
        `Failed to merge file: ${response.status} ${response.statusText}`
      )
    }

    const result: MergeFileResponse = await response.json()

    if (result.code !== 200) {
      throw new Error('File merge failed')
    }

    return result.url
  }

  /**
   * 下载文件
   * GET /file/:url
   * 格式：文件名 + 下划线 + 32位文件哈希值 + 文件后缀
   */
  getDownloadUrl(filename: string, fileHash: string): string {
    return `${encodeURIComponent(filename)}_${fileHash}.${filename.split('.').pop()}`
  }
}
