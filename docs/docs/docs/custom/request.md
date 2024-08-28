# 请求策略

wf-upload 内部基于 fetch 实现了默认的请求策略，同时也可以根据接口 RequestStrategy 实现自定义的请求策略。

## 请求策略接口类型

```TypeScript
export interface RequestStrategy {
  // 文件创建请求
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
```

## 自定义请求策略

比如基于 axios 实现自定义的请求策略：

```TypeScript
import axios from 'axios'
import type { RequestStrategy, CreateFile, UploadChunk } from '@wf-upload/core'

export class AxiosRequestStrategy implements RequestStrategy {
  private baseURL: string

  constructor(baseURL: string) {
    this.baseURL = baseURL
  }

  async createFile(
    file: CreateFile
  ): Promise<{ status: string; token: string }> {
    const response = await axios.post(`${this.baseURL}/create`, file)
    return response.data
  }

  async uploadChunk(chunk: UploadChunk): Promise<{ status: string }> {
    const data = new FormData()
    data.set('token', chunk.token)
    data.set('blob', chunk.blob)
    data.set('hash', chunk.hash)
    data.set('start', chunk.start.toString())
    data.set('end', chunk.end.toString())
    data.set('index', chunk.index.toString())

    const response = await axios.post(`${this.baseURL}/uploadChunk`, data, {
      headers: { 'content-type': 'multipart/form-data' },
    })
    return response.data
  }

  async mergeFile(
    token: string,
    hash: string
  ): Promise<{
    status: string
    url: string
  }> {
    const data = {
      token,
      hash,
    }
    const response = await axios.post(`${this.baseURL}/merge`, data)
    return response.data
  }

  async patchHash<T extends 'file' | 'chunk'>(
    token: string,
    hash: string,
    type: T
  ): Promise<
    T extends 'chunk'
      ? { status: string; hasFile: boolean }
      : { status: string; hasFile: boolean; url: string }
  > {
    const data = {
      token,
      hash,
      type,
    }
    const response = await axios.post(`${this.baseURL}/patchHash`, data)
    return response.data
  }
}

```

使用该策略：

```TypeScript
import { WfUpload } from '@wf-upload/core'
import { AxiosRequestStrategy } from './utils/request'

let uc: WfUpload | null = null
uc = new WfUpload(file, new AxiosRequestStrategy('/file'))
```
