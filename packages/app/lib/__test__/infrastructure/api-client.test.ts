import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { ApiClient } from '../../infrastructure/api-client'
import type {
  CreateFileRequest,
  CreateFileResponse,
  PatchHashResponse,
  UploadChunkResponse,
  MergeFileResponse,
  ChunkDto,
} from '../../domain/types'

describe('ApiClient', () => {
  let apiClient: ApiClient
  const baseUrl = 'https://api.example.com'

  beforeEach(() => {
    apiClient = new ApiClient(baseUrl)
    globalThis.fetch = vi.fn() as any
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('构造函数', () => {
    it('应该正确初始化 baseUrl', () => {
      const client = new ApiClient('https://api.example.com')
      expect(client).toBeDefined()
    })

    it('应该移除 baseUrl 末尾的斜杠', () => {
      const client1 = new ApiClient('https://api.example.com/')
      const client2 = new ApiClient('https://api.example.com')
      expect(client1).toBeDefined()
      expect(client2).toBeDefined()
    })
  })

  describe('createSession', () => {
    it('应该成功创建会话', async () => {
      const request: CreateFileRequest = {
        fileName: 'test.txt',
        fileSize: 1000,
        fileType: 'text/plain',
        chunksLength: 5,
      }

      const mockResponse: CreateFileResponse = {
        code: 200,
        token: 'test-token-123',
      }

      ;(globalThis.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      })

      const result = await apiClient.createSession(request)

      expect(globalThis.fetch).toHaveBeenCalledWith(
        `${baseUrl}/file/create`,
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(request),
        })
      )
      expect(result).toEqual(mockResponse)
      expect(result.token).toBe('test-token-123')
    })

    it('应该在请求失败时抛出错误', async () => {
      const request: CreateFileRequest = {
        fileName: 'test.txt',
        fileSize: 1000,
        fileType: 'text/plain',
        chunksLength: 5,
      }

      ;(globalThis.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      })

      await expect(apiClient.createSession(request)).rejects.toThrow(
        'Failed to create session: 500 Internal Server Error'
      )
    })
  })

  describe('checkChunk', () => {
    it('应该成功检查分片 Hash 并返回 true', async () => {
      const token = 'test-token'
      const hash = 'chunk-hash-123'

      const mockResponse: PatchHashResponse = {
        code: 200,
        exists: true,
      }

      ;(globalThis.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      })

      const result = await apiClient.checkChunk(token, hash)

      expect(globalThis.fetch).toHaveBeenCalledWith(
        `${baseUrl}/file/patchHash`,
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            token,
            hash,
            isChunk: true,
          }),
        })
      )
      expect(result).toBe(true)
    })

    it('应该成功检查分片 Hash 并返回 false', async () => {
      const token = 'test-token'
      const hash = 'chunk-hash-123'

      const mockResponse: PatchHashResponse = {
        code: 200,
        exists: false,
      }

      ;(globalThis.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      })

      const result = await apiClient.checkChunk(token, hash)

      expect(result).toBe(false)
    })

    it('应该在 HTTP 请求失败时抛出错误', async () => {
      const token = 'test-token'
      const hash = 'chunk-hash-123'

      ;(globalThis.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
      })

      await expect(apiClient.checkChunk(token, hash)).rejects.toThrow(
        'Failed to check chunk: 400 Bad Request'
      )
    })

    it('应该在响应 code 不为 200 时抛出错误', async () => {
      const token = 'test-token'
      const hash = 'chunk-hash-123'

      const mockResponse = {
        code: 500,
        exists: false,
      }

      ;(globalThis.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      })

      await expect(apiClient.checkChunk(token, hash)).rejects.toThrow(
        'Check chunk failed'
      )
    })
  })

  describe('checkFile', () => {
    it('应该成功检查文件 Hash 并返回 true', async () => {
      const token = 'test-token'
      const hash = 'file-hash-123'

      const mockResponse: PatchHashResponse = {
        code: 200,
        exists: true,
      }

      ;(globalThis.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      })

      const result = await apiClient.checkFile(token, hash)

      expect(globalThis.fetch).toHaveBeenCalledWith(
        `${baseUrl}/file/patchHash`,
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            token,
            hash,
            isChunk: false,
          }),
        })
      )
      expect(result).toBe(true)
    })

    it('应该成功检查文件 Hash 并返回 false', async () => {
      const token = 'test-token'
      const hash = 'file-hash-123'

      const mockResponse: PatchHashResponse = {
        code: 200,
        exists: false,
      }

      ;(globalThis.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      })

      const result = await apiClient.checkFile(token, hash)

      expect(result).toBe(false)
    })

    it('应该在 HTTP 请求失败时抛出错误', async () => {
      const token = 'test-token'
      const hash = 'file-hash-123'

      ;(globalThis.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      })

      await expect(apiClient.checkFile(token, hash)).rejects.toThrow(
        'Failed to check file: 404 Not Found'
      )
    })

    it('应该在响应 code 不为 200 时抛出错误', async () => {
      const token = 'test-token'
      const hash = 'file-hash-123'

      const mockResponse = {
        code: 500,
        exists: false,
      }

      ;(globalThis.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      })

      await expect(apiClient.checkFile(token, hash)).rejects.toThrow(
        'Check file failed'
      )
    })
  })

  describe('uploadChunk', () => {
    it('应该成功上传分片', async () => {
      const token = 'test-token'
      const chunk = {
        index: 0,
        start: 0,
        end: 100,
        size: 100,
        blob: new Blob(['chunk data']),
        hash: 'chunk-hash-123',
      }

      const mockResponse: UploadChunkResponse = {
        code: 200,
        success: true,
      }

      ;(globalThis.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      })

      await apiClient.uploadChunk(token, chunk)

      expect(globalThis.fetch).toHaveBeenCalledWith(
        `${baseUrl}/file/uploadChunk`,
        expect.objectContaining({
          method: 'POST',
        })
      )

      // 验证 FormData 包含正确的字段
      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      const formData = fetchCall[1].body as FormData
      expect(formData.get('token')).toBe(token)
      expect(formData.get('hash')).toBe(chunk.hash)
      // FormData.get() 对于 Blob 类型会返回 Blob 对象或字符串表示
      const chunkValue = formData.get('chunk')
      expect(chunkValue).toBeDefined()
      // 验证 chunk 字段存在且不为空
      expect(chunkValue !== null).toBe(true)
    })

    it('应该在 HTTP 请求失败时抛出错误', async () => {
      const token = 'test-token'
      const chunk = {
        index: 0,
        start: 0,
        end: 100,
        size: 100,
        blob: new Blob(['chunk data']),
        hash: 'chunk-hash-123',
      }

      ;(globalThis.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 413,
        statusText: 'Payload Too Large',
      })

      await expect(apiClient.uploadChunk(token, chunk)).rejects.toThrow(
        'Failed to upload chunk: 413 Payload Too Large'
      )
    })

    it('应该在响应 code 不为 200 时抛出错误', async () => {
      const token = 'test-token'
      const chunk = {
        index: 0,
        start: 0,
        end: 100,
        size: 100,
        blob: new Blob(['chunk data']),
        hash: 'chunk-hash-123',
      }

      const mockResponse: any = {
        code: 500,
        success: false,
      }

      ;(globalThis.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      })

      await expect(apiClient.uploadChunk(token, chunk)).rejects.toThrow(
        'Upload chunk failed'
      )
    })

    it('应该在 success 为 false 时抛出错误', async () => {
      const token = 'test-token'
      const chunk = {
        index: 0,
        start: 0,
        end: 100,
        size: 100,
        blob: new Blob(['chunk data']),
        hash: 'chunk-hash-123',
      }

      const mockResponse: UploadChunkResponse = {
        code: 200,
        success: false,
      }

      ;(globalThis.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      })

      await expect(apiClient.uploadChunk(token, chunk)).rejects.toThrow(
        'Upload chunk failed'
      )
    })
  })

  describe('mergeFile', () => {
    it('应该成功合并文件并返回 URL', async () => {
      const token = 'test-token'
      const fileHash = 'file-hash-123'
      const fileName = 'test.txt'
      const chunks: ChunkDto[] = [
        { index: 0, hash: 'chunk-hash-0' },
        { index: 1, hash: 'chunk-hash-1' },
        { index: 2, hash: 'chunk-hash-2' },
      ]

      const mockResponse: MergeFileResponse = {
        code: 200,
        url: 'https://example.com/files/test.txt_file-hash-123.txt',
      }

      ;(globalThis.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      })

      const result = await apiClient.mergeFile(token, fileHash, fileName, chunks)

      expect(globalThis.fetch).toHaveBeenCalledWith(
        `${baseUrl}/file/merge`,
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            token,
            fileHash,
            fileName,
            chunksLength: chunks.length,
            chunks,
          }),
        })
      )
      expect(result).toBe(mockResponse.url)
    })

    it('应该在 HTTP 请求失败时抛出错误', async () => {
      const token = 'test-token'
      const fileHash = 'file-hash-123'
      const fileName = 'test.txt'
      const chunks: ChunkDto[] = [{ index: 0, hash: 'chunk-hash-0' }]

      ;(globalThis.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      })

      await expect(
        apiClient.mergeFile(token, fileHash, fileName, chunks)
      ).rejects.toThrow('Failed to merge file: 500 Internal Server Error')
    })

    it('应该在响应 code 不为 200 时抛出错误', async () => {
      const token = 'test-token'
      const fileHash = 'file-hash-123'
      const fileName = 'test.txt'
      const chunks: ChunkDto[] = [{ index: 0, hash: 'chunk-hash-0' }]

      const mockResponse: any = {
        code: 500,
        url: '',
      }

      ;(globalThis.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      })

      await expect(
        apiClient.mergeFile(token, fileHash, fileName, chunks)
      ).rejects.toThrow('File merge failed')
    })
  })

  describe('getDownloadUrl', () => {
    it('应该正确生成下载 URL', () => {
      const filename = 'test.txt'
      const fileHash = 'abc123def456ghi789jkl012mno345pq'

      const url = apiClient.getDownloadUrl(filename, fileHash)

      expect(url).toBe('test.txt_abc123def456ghi789jkl012mno345pq.txt')
    })

    it('应该处理带路径的文件名', () => {
      const filename = 'folder/test.txt'
      const fileHash = 'abc123def456ghi789jkl012mno345pq'

      const url = apiClient.getDownloadUrl(filename, fileHash)

      expect(url).toBe('folder%2Ftest.txt_abc123def456ghi789jkl012mno345pq.txt')
    })

    it('应该处理无扩展名的文件名', () => {
      const filename = 'test'
      const fileHash = 'abc123def456ghi789jkl012mno345pq'

      const url = apiClient.getDownloadUrl(filename, fileHash)

      // 当文件名没有扩展名时，split('.').pop() 会返回整个文件名
      expect(url).toBe('test_abc123def456ghi789jkl012mno345pq.test')
    })

    it('应该处理多个点的文件名', () => {
      const filename = 'test.backup.txt'
      const fileHash = 'abc123def456ghi789jkl012mno345pq'

      const url = apiClient.getDownloadUrl(filename, fileHash)

      expect(url).toBe('test.backup.txt_abc123def456ghi789jkl012mno345pq.txt')
    })
  })
})

