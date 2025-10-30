/**
 * API客户端
 * 处理与服务端的HTTP通信，严格遵循文档中的API契约
 */

import type {
  CreateFileRequest,
  CreateFileResponse,
  PatchHashRequest,
  PatchHashResponse,
  PatchHashChunkResponse,
  PatchHashFileResponse,
  UploadChunkResponse,
  MergeFileRequest,
  MergeResponse,
  ChunkInfo
} from './types';

export class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  }

  /**
   * 创建文件上传会话
   * POST /file/create
   */
  async createSession(request: CreateFileRequest): Promise<CreateFileResponse> {
    const response = await fetch(`${this.baseUrl}/file/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(request)
    });

    if (!response.ok) {
      throw new Error(`Failed to create session: ${response.status} ${response.statusText}`);
    }

    return await response.json();
  }

  /**
   * 检查分片Hash
   * POST /file/patchHash (type: 'chunk')
   */
  async checkChunk(token: string, hash: string): Promise<boolean> {
    const request: PatchHashRequest = {
      token,
      hash,
      type: 'chunk'
    };

    const response = await fetch(`${this.baseUrl}/file/patchHash`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(request)
    });

    if (!response.ok) {
      throw new Error(`Failed to check chunk: ${response.status} ${response.statusText}`);
    }

    const result: PatchHashResponse = await response.json();
    
    if (result.status === 'error') {
      throw new Error(result.message);
    }

    return (result as PatchHashChunkResponse).hasChunk;
  }

  /**
   * 检查文件Hash（文件秒传）
   * POST /file/patchHash (type: 'file')
   */
  async checkFile(token: string, hash: string): Promise<{ exists: boolean; url?: string }> {
    const request: PatchHashRequest = {
      token,
      hash,
      type: 'file'
    };

    const response = await fetch(`${this.baseUrl}/file/patchHash`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(request)
    });

    if (!response.ok) {
      throw new Error(`Failed to check file: ${response.status} ${response.statusText}`);
    }

    const result: PatchHashResponse = await response.json();
    
    if (result.status === 'error') {
      throw new Error(result.message);
    }

    const fileResult = result as PatchHashFileResponse;
    return {
      exists: fileResult.hasFile,
      url: fileResult.url
    };
  }

  /**
   * 上传分片
   * POST /file/uploadChunk
   */
  async uploadChunk(token: string, chunk: ChunkInfo & { hash: string }): Promise<void> {
    const formData = new FormData();
    formData.append('blob', chunk.blob);
    formData.append('token', token);
    formData.append('hash', chunk.hash);

    const response = await fetch(`${this.baseUrl}/file/uploadChunk`, {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      throw new Error(`Failed to upload chunk: ${response.status} ${response.statusText}`);
    }

    const result: UploadChunkResponse = await response.json();
    
    if (result.status !== 'ok') {
      throw new Error('Upload chunk failed');
    }
  }

  /**
   * 合并文件
   * POST /file/merge
   */
  async mergeFile(token: string, hash: string): Promise<string> {
    const request: MergeFileRequest = {
      token,
      hash
    };

    const response = await fetch(`${this.baseUrl}/file/merge`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(request)
    });

    if (!response.ok) {
      throw new Error(`Failed to merge file: ${response.status} ${response.statusText}`);
    }

    const result: MergeResponse = await response.json();
    
    if (result.status === 'error') {
      throw new Error(result.message);
    }

    return result.url;
  }

  /**
   * 下载文件
   * GET /file/:url
   */
  getDownloadUrl(filename: string): string {
    return `${this.baseUrl}/file/${encodeURIComponent(filename)}`;
  }
}