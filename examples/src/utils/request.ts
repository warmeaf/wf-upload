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
    T extends 'file'
      ? { hasFile: boolean }
      : { hasFile: boolean; rest: number[]; url: string }
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
