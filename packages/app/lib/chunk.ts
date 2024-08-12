import SparkMD5 from 'spark-md5';

export interface Chunk {
  blob: Blob; // 分片的二进制数据
  start: number; // 分片的起始位置
  end: number; // 分片的结束位置
  hash: string; // 分片的hash值
  index: number; // 分片在文件中的索引
}

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