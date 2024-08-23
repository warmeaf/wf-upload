import type { RequestStrategy, CreateFile, UploadChunk } from './type'

export class FetchRequestStrategy implements RequestStrategy {
  private baseURL: string

  constructor(baseURL: string) {
    this.baseURL = baseURL
  }

  async createFile(
    file: CreateFile
  ): Promise<{ status: string; token: string }> {
    const response = await fetch(`${this.baseURL}/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(file),
    })
    return response.json()
  }

  async uploadChunk(chunk: UploadChunk): Promise<{ status: string }> {
    const data = new FormData()
    data.set('token', chunk.token)
    data.set('blob', chunk.blob)
    data.set('hash', chunk.hash)
    data.set('start', chunk.start.toString())
    data.set('end', chunk.end.toString())
    data.set('index', chunk.index.toString())

    const response = await fetch(`${this.baseURL}/uploadChunk`, {
      method: 'POST',
      body: data,
    })
    return response.json()
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
    const response = await fetch(`${this.baseURL}/merge`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    })
    return response.json()
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
    const response = await fetch(`${this.baseURL}/patchHash`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    })
    return response.json()
  }
}
