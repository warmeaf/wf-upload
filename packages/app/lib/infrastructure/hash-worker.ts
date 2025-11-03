/**
 * Hash计算Worker线程
 * 负责文件分片和Hash计算，严格按照文档流程执行
 */

import SparkMD5 from 'spark-md5'
import type {
  WorkerStartMessage,
  WorkerMessage,
  WorkerTaskMessage,
  WorkerResultMessage,
  WorkerTaskErrorMessage,
  ChunkInfo,
} from '../domain/types'

declare const self: Worker

// ============ 文件分片 ============

function createChunks(file: File, chunkSize: number): ChunkInfo[] {
  const chunks: ChunkInfo[] = []
  let start = 0
  let index = 0

  while (start < file.size) {
    const end = Math.min(start + chunkSize, file.size)
    const blob = file.slice(start, end)

    chunks.push({
      index,
      start,
      end,
      size: end - start,
      blob,
    })

    start = end
    index++
  }

  return chunks
}

// ============ Hash计算 ============

async function calculateChunkHash(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = (e) => {
      try {
        const arrayBuffer = e.target?.result as ArrayBuffer
        const hash = SparkMD5.ArrayBuffer.hash(arrayBuffer)
        resolve(hash.toLowerCase())
      } catch (error) {
        reject(error)
      }
    }

    reader.onerror = () => reject(new Error('Failed to read chunk'))
    reader.readAsArrayBuffer(blob)
  })
}

function calculateFileHash(chunkHashes: string[]): string {
  const spark = new SparkMD5()

  for (const chunkHash of chunkHashes) {
    spark.append(chunkHash)
  }

  return spark.end().toLowerCase()
}

async function loopCalculateChunkHash(
  chunks: ChunkInfo[],
  callback: (chunk: ChunkInfo, hash: string) => void
): Promise<void> {
  for (const chunk of chunks) {
    const hash = await calculateChunkHash(chunk.blob)
    callback(chunk, hash)
  }
}

// ============ 消息发送 ============

function postChunkHashedMessage(chunk: ChunkInfo & { hash: string }): void {
  const message: WorkerMessage = {
    type: 'chunkHashed',
    chunk: { ...chunk },
  }
  self.postMessage(message)
}

function postAllChunksHashedMessage(): void {
  const message: WorkerMessage = {
    type: 'allChunksHashed',
  }
  self.postMessage(message)
}

function postFileHashedMessage(fileHash: string): void {
  const message: WorkerMessage = {
    type: 'fileHashed',
    fileHash,
  }
  self.postMessage(message)
}

// ============ 主处理流程 ============

async function processFile(file: File, chunkSize: number) {
  try {
    const chunks = createChunks(file, chunkSize)
    const chunkHashes: string[] = []

    await loopCalculateChunkHash(chunks, (chunk, hash) => {
      chunkHashes.push(hash)
      postChunkHashedMessage({ ...chunk, hash })
    })

    postAllChunksHashedMessage()
    postFileHashedMessage(calculateFileHash(chunkHashes))
  } catch (error) {
    const errorMessage: WorkerMessage = {
      type: 'error',
      error: error instanceof Error ? error.message : String(error),
    }
    self.postMessage(errorMessage)
  }
}

// ============ Worker消息监听 ============

self.onmessage = (
  e: MessageEvent<WorkerStartMessage | WorkerTaskMessage>
) => {
  const { type } = e.data

  if (type === 'start') {
    // 单线程模式：处理整个文件
    const { file, chunkSize } = e.data as WorkerStartMessage
    processFile(file, chunkSize)
  } else if (type === 'task') {
    // 多线程模式：处理单个分片
    const { taskId, chunkIndex, blob } = e.data as WorkerTaskMessage
    processChunk(taskId, chunkIndex, blob)
  }
}

// ============ 多线程模式：处理单个分片 ============

async function processChunk(
  taskId: string,
  chunkIndex: number,
  blob: Blob
): Promise<void> {
  try {
    const hash = await calculateChunkHash(blob)

    // 发送结果回主线程
    const resultMessage: WorkerResultMessage = {
      type: 'result',
      taskId,
      chunkIndex,
      hash,
    }
    self.postMessage(resultMessage)
  } catch (error) {
    // 发送错误消息
    const errorMessage: WorkerTaskErrorMessage = {
      type: 'error',
      taskId,
      error: error instanceof Error ? error.message : String(error),
    }
    self.postMessage(errorMessage)
  }
}

