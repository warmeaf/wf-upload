/**
 * Hash计算Worker线程
 * 负责文件分片和Hash计算，严格按照文档流程执行
 */

import SparkMD5 from 'spark-md5';
import type { 
  WorkerStartMessage, 
  WorkerMessage, 
  ChunkInfo 
} from './types';

// Worker环境类型声明
declare const self: Worker;

/**
 * 创建文件分片
 */
function createChunks(file: File, chunkSize: number): ChunkInfo[] {
  const chunks: ChunkInfo[] = [];
  let start = 0;
  let index = 0;

  while (start < file.size) {
    const end = Math.min(start + chunkSize, file.size);
    const blob = file.slice(start, end);
    
    chunks.push({
      index,
      start,
      end,
      size: end - start,
      blob
    });

    start = end;
    index++;
  }

  return chunks;
}

/**
 * 计算分片Hash
 */
async function calculateChunkHash(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      try {
        const arrayBuffer = e.target?.result as ArrayBuffer;
        const hash = SparkMD5.ArrayBuffer.hash(arrayBuffer);
        resolve(hash.toLowerCase());
      } catch (error) {
        reject(error);
      }
    };
    
    reader.onerror = () => reject(new Error('Failed to read chunk'));
    reader.readAsArrayBuffer(blob);
  });
}

/**
 * 增量计算文件Hash
 * 将所有分片hash按顺序增量计算作为fileHash
 */
function calculateFileHash(chunkHashes: string[]): string {
  const spark = new SparkMD5();
  
  for (const chunkHash of chunkHashes) {
    spark.append(chunkHash);
  }
  
  return spark.end().toLowerCase();
}

/**
 * 主处理函数
 */
async function processFile(file: File, chunkSize: number) {
  try {
    // 1. 创建分片
    const chunks = createChunks(file, chunkSize);
    const chunkHashes: string[] = [];

    // 2. 逐个计算分片Hash并发送事件
    for (const chunk of chunks) {
      const hash = await calculateChunkHash(chunk.blob);
      chunkHashes.push(hash);

      // 发送ChunkHashed事件
      const message: WorkerMessage = {
        type: 'chunkHashed',
        chunk: { ...chunk, hash }
      };
      self.postMessage(message);
    }

    // 3. 发送AllChunksHashed事件
    const allChunksHashedMessage: WorkerMessage = {
      type: 'allChunksHashed'
    };
    self.postMessage(allChunksHashedMessage);

    // 4. 计算文件Hash并发送事件
    const fileHash = calculateFileHash(chunkHashes);
    const fileHashedMessage: WorkerMessage = {
      type: 'fileHashed',
      fileHash
    };
    self.postMessage(fileHashedMessage);

  } catch (error) {
    // 发送错误事件
    const errorMessage: WorkerMessage = {
      type: 'error',
      error: error instanceof Error ? error.message : String(error)
    };
    self.postMessage(errorMessage);
  }
}

// 监听主线程消息
self.onmessage = (e: MessageEvent<WorkerStartMessage>) => {
  const { type, file, chunkSize } = e.data;
  
  if (type === 'start') {
    processFile(file, chunkSize);
  }
};