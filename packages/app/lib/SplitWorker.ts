import { calcChunkHash } from './chunk'
import type { Chunk } from './type'

/**
 * 处理 Web Worker 中的传入消息。
 * @param {MessageEvent} e - 包含 chunks 数据的消息事件。
 */
onmessage = function (e) {
  const chunks = e.data as Chunk[]
  // 如果 chunks 的长度比较大，比如 175 初始计算就会很耗时
  for (const chunk of chunks) {
    calcChunkHash(chunk).then((hash) => {
      // console.log('计算好的 hash 发给主线程', new Date().getTime())
      chunk.hash = hash
      postMessage([chunk])
    })
  }
}
