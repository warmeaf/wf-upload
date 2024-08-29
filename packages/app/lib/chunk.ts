import SparkMD5 from 'spark-md5'
import type { Chunk } from './type'

/**
 * 创建文件的一个分块
 * @param {File} file - 要分块的文件对象
 * @param {number} index - 当前分块的索引
 * @param {number} chunkSize - 每个分块的大小（字节）
 * @returns {Chunk} 包含分块信息的对象
 */
export function createChunk(
  file: File,
  index: number,
  chunkSize: number
): Chunk {
  const start = index * chunkSize
  const end = Math.min((index + 1) * chunkSize, file.size)
  const blob = file.slice(start, end)
  return {
    blob,
    start,
    end,
    hash: '',
    index,
  }
}

/**
 * 异步计算给定分块的哈希值。
 * @param {Chunk} chunk - 包含要计算哈希值的 blob 的分块对象。
 * @returns {Promise<string>} 一个 Promise，解析为计算出的哈希值。
 */
export function calcChunkHash(chunk: Chunk): Promise<string> {
  // 函数定义：接受一个Chunk类型的参数，返回一个Promise<string>

  return new Promise((resolve) => {
    // 创建一个新的Promise，用于异步计算哈希值

    const spark = new SparkMD5.ArrayBuffer()
    // 创建SparkMD5的ArrayBuffer实例，用于计算哈希值

    const fileReader = new FileReader()
    // 创建FileReader实例，用于读取文件内容

    fileReader.onload = (e) => {
      // 定义FileReader的onload事件处理函数

      spark.append(e.target?.result as ArrayBuffer)
      // 将读取的文件内容（ArrayBuffer）添加到spark实例中

      resolve(spark.end())
      // 计算最终的哈希值并通过resolve返回结果
    }

    fileReader.readAsArrayBuffer(chunk.blob)
    // 开始读取chunk的blob内容，读取完成后会触发onload事件
  })
}
