# 自定义 API 客户端

如果需要适配不同的后端 API 或使用自定义的 HTTP 客户端，可以实现自定义的 API 客户端。

## ApiClient 类

`ApiClient` 是负责与后端通信的类，位于 `infrastructure/api-client.ts`。你可以继承或替换它来实现自定义的 API 客户端。

## 查看默认实现

首先，让我们看看默认的 `ApiClient` 实现：

```typescript
import { ApiClient } from '@wf-upload/core'

// ApiClient 使用 fetch API 进行通信
// 你可以查看源码了解其实现方式
```

## 自定义实现

创建一个自定义的 API 客户端类：

```typescript
import { ApiClient } from '@wf-upload/core'
import type {
  CreateFileRequest,
  CreateFileResponse,
  PatchHashRequest,
  PatchHashResponse,
  UploadChunkRequest,
  UploadChunkResponse,
  MergeFileRequest,
  MergeFileResponse,
  ChunkInfo,
} from '@wf-upload/core'

class CustomApiClient extends ApiClient {
  // 如果需要修改默认行为，可以重写方法
  async createSession(request: CreateFileRequest): Promise<CreateFileResponse> {
    // 自定义实现
    const response = await fetch(`${this.baseUrl}/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    })
    
    if (!response.ok) {
      throw new Error(`创建会话失败: ${response.statusText}`)
    }
    
    return response.json()
  }
}
```

## 使用 Axios 实现

如果你想使用 Axios 而不是 fetch：

```typescript
import axios from 'axios'
import type {
  CreateFileRequest,
  CreateFileResponse,
  PatchHashRequest,
  PatchHashResponse,
  UploadChunkRequest,
  UploadChunkResponse,
  MergeFileRequest,
  MergeFileResponse,
  ChunkInfo,
} from '@wf-upload/core'

class AxiosApiClient {
  private baseUrl: string
  private axiosInstance: any

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl
    this.axiosInstance = axios.create({
      baseURL: baseUrl,
      timeout: 30000,
    })
  }

  async createSession(request: CreateFileRequest): Promise<CreateFileResponse> {
    const response = await this.axiosInstance.post('/create', request)
    return response.data
  }

  async checkChunk(token: string, hash: string): Promise<boolean> {
    const response = await this.axiosInstance.post('/patchHash', {
      token,
      hash,
      isChunk: true,
    })
    return response.data.exists
  }

  async checkFile(token: string, hash: string): Promise<boolean> {
    const response = await this.axiosInstance.post('/patchHash', {
      token,
      hash,
      isChunk: false,
    })
    return response.data.exists
  }

  async uploadChunk(
    token: string,
    chunk: ChunkInfo & { hash: string }
  ): Promise<void> {
    const formData = new FormData()
    formData.append('chunk', chunk.blob)
    formData.append('token', token)
    formData.append('hash', chunk.hash)

    await this.axiosInstance.post('/uploadChunk', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    })
  }

  async mergeFile(
    token: string,
    fileHash: string,
    fileName: string,
    chunks: Array<{ index: number; hash: string }>
  ): Promise<string> {
    const response = await this.axiosInstance.post('/merge', {
      token,
      fileHash,
      fileName,
      chunksLength: chunks.length,
      chunks,
    })
    return response.data.url
  }
}
```

## 在 FileUploader 中使用自定义客户端

由于 `FileUploader` 内部创建了 `ApiClient` 实例，目前无法直接注入自定义客户端。如果需要使用自定义客户端，可以考虑：

### 方案 1: Fork 并修改源码

修改 `FileUploader` 源码，支持注入自定义的 API 客户端。

### 方案 2: 修改 FileUploader 源码支持注入

修改 `packages/app/lib/presentation/file-uploader.ts`：

```typescript
export interface FileUploaderOptions {
  config: UploadConfig
  apiClient?: ApiClient  // 添加可选的自定义客户端
  onProgress?: (state: UploaderState) => void
  onCompleted?: (downloadUrl: string) => void
  onError?: (error: Error) => void
}

export class FileUploader implements EventEmitter {
  private apiClient: ApiClient

  constructor(options: FileUploaderOptions) {
    this.options = options
    // 使用自定义客户端或创建默认客户端
    this.apiClient = options.apiClient || new ApiClient(options.config.baseUrl)
    // ...
  }
}
```

然后就可以这样使用：

```typescript
import { FileUploader } from '@wf-upload/core'
import { AxiosApiClient } from './custom-api-client'

const customClient = new AxiosApiClient('http://localhost:3000/api/file')

const uploader = new FileUploader({
  config: {
    chunkSize: 2 * 1024 * 1024,
    concurrency: 3,
    baseUrl: 'http://localhost:3000/api/file',
  },
  apiClient: customClient, // 使用自定义客户端
  onProgress: (state) => {
    console.log('进度:', state.progress)
  },
})
```

## 添加请求拦截器

如果需要添加认证、日志等功能：

```typescript
class AuthenticatedApiClient extends ApiClient {
  private authToken: string

  constructor(baseUrl: string, authToken: string) {
    super(baseUrl)
    this.authToken = authToken
  }

  private async requestWithAuth(
    url: string,
    options: RequestInit = {}
  ): Promise<Response> {
    const headers = new Headers(options.headers)
    headers.set('Authorization', `Bearer ${this.authToken}`)
    
    return fetch(url, {
      ...options,
      headers,
    })
  }

  async createSession(request: CreateFileRequest): Promise<CreateFileResponse> {
    const response = await this.requestWithAuth(`${this.baseUrl}/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    })
    
    if (!response.ok) {
      throw new Error(`创建会话失败: ${response.statusText}`)
    }
    
    return response.json()
  }

  // 重写其他方法以添加认证...
}
```

## 添加错误处理和重试

```typescript
class RetryableApiClient extends ApiClient {
  private maxRetries: number

  constructor(baseUrl: string, maxRetries: number = 3) {
    super(baseUrl)
    this.maxRetries = maxRetries
  }

  private async retryRequest<T>(
    fn: () => Promise<T>,
    retries: number = this.maxRetries
  ): Promise<T> {
    try {
      return await fn()
    } catch (error) {
      if (retries > 0) {
        console.log(`请求失败，重试中... (剩余 ${retries} 次)`)
        await new Promise((resolve) => setTimeout(resolve, 1000)) // 等待 1 秒
        return this.retryRequest(fn, retries - 1)
      }
      throw error
    }
  }

  async uploadChunk(
    token: string,
    chunk: ChunkInfo & { hash: string }
  ): Promise<void> {
    return this.retryRequest(() => super.uploadChunk(token, chunk))
  }
}
```

## 注意事项

1. **API 契约**: 确保自定义客户端实现的接口与默认客户端一致
2. **错误处理**: 正确处理各种错误情况
3. **类型安全**: 使用 TypeScript 类型定义确保类型安全
4. **测试**: 充分测试自定义客户端的功能

## 参考

- [ApiClient 源码](../../../packages/app/lib/infrastructure/api-client.ts)
- [类型定义](../api/types)
