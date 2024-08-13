import SparkMD5 from 'spark-md5';
import type { Chunk } from './type';

// 创建一个不带hash的chunk
export function createChunk(
  file: File,
  index: number,
  chunkSize: number
): Chunk {
  const start = index * chunkSize;
  const end = Math.min((index + 1) * chunkSize, file.size);
  const blob = file.slice(start, end);
  return {
    blob,
    start,
    end,
    hash: '',
    index,
  };
}

// 计算chunk的hash值
export function calcChunkHash(chunk: Chunk): Promise<string> {
  return new Promise((resolve) => {
    const spark = new SparkMD5.ArrayBuffer();
    const fileReader = new FileReader();
    fileReader.onload = (e) => {
      spark.append(e.target?.result as ArrayBuffer);
      resolve(spark.end());
    };
    fileReader.readAsArrayBuffer(chunk.blob);
  });
}