import { describe, it, expect, vi } from 'vitest'
import { createChunk, calcChunkHash } from '../chunk'
import SparkMD5 from 'spark-md5'

vi.mock('spark-md5', () => ({
  default: {
    ArrayBuffer: vi.fn().mockImplementation(() => ({
      append: vi.fn(),
      end: vi.fn().mockReturnValue('mockedHash'),
    })),
  },
}))

describe('chunk functions', () => {
  describe('createChunk', () => {
    it('should create a chunk correctly', () => {
      const file = new File(['testcontent'], 'test.txt', { type: 'text/plain' })
      const index = 0
      const chunkSize = 5

      const chunk = createChunk(file, index, chunkSize)

      expect(chunk).toEqual({
        blob: expect.any(Blob),
        start: 0,
        end: 5,
        hash: '',
        index: 0,
      })
      expect(chunk.blob.size).toBe(5)
    })

    it('should handle last chunk correctly', () => {
      const file = new File(['testcontent'], 'test.txt', { type: 'text/plain' })
      const index = 2
      const chunkSize = 5

      const chunk = createChunk(file, index, chunkSize)

      expect(chunk).toEqual({
        blob: expect.any(Blob),
        start: 10,
        end: 11,
        hash: '',
        index: 2,
      })
      expect(chunk.blob.size).toBe(1)
    })
  })

  describe('calcChunkHash', () => {
    it('should calculate chunk hash correctly', async () => {
      const mockChunk = {
        blob: new Blob(['testcontent']),
        start: 0,
        end: 11,
        hash: '',
        index: 0,
      }

      const hash = await calcChunkHash(mockChunk)

      expect(hash).toBe('mockedHash')
      expect(SparkMD5.ArrayBuffer).toHaveBeenCalled()
    })
  })
})
