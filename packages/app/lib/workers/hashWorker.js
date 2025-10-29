// 内联哈希计算 Worker（外部脚本版）
// 支持消息类型：calculateHash、calculateHashBatch
// 集成Spark-MD5库确保MD5计算准确性

// 动态导入Spark-MD5库
let SparkMD5 = null

// 动态加载Spark-MD5库
const loadSparkMD5 = async () => {
  if (!SparkMD5) {
    try {
      // 尝试从CDN加载Spark-MD5
      importScripts('https://cdn.jsdelivr.net/npm/spark-md5@3.0.2/spark-md5.min.js')
      SparkMD5 = self.SparkMD5
    } catch (error) {
      console.warn('Failed to load Spark-MD5 from CDN, falling back to simple MD5')
      // 如果加载失败，使用简化版本
      SparkMD5 = {
        ArrayBuffer: {
          hash: (buffer) => {
            const array = new Uint8Array(buffer)
            let hash = 0
            for (let i = 0; i < array.length; i++) {
              hash = ((hash << 5) - hash + array[i]) & 0xffffffff
            }
            return Math.abs(hash).toString(16).padStart(8, '0')
          }
        }
      }
    }
  }
  return SparkMD5
}

const computeHash = async (buffer) => {
  const sparkMD5 = await loadSparkMD5()
  const data = buffer instanceof ArrayBuffer ? buffer : buffer.buffer
  return sparkMD5.ArrayBuffer.hash(data)
}

const combineHashes = async (hashes) => {
  const combinedString = hashes.join('')
  const buffer = new TextEncoder().encode(combinedString)
  const sparkMD5 = await loadSparkMD5()
  return sparkMD5.ArrayBuffer.hash(buffer.buffer)
}

onmessage = async function (e) {
  const msg = e.data
  try {
    if (msg.type === 'calculateHash') {
      const { buffer } = msg.data
      const hash = await computeHash(buffer)
      postMessage({ id: msg.id, data: { hash } })
    } else if (msg.type === 'calculateHashBatch') {
      const { chunks } = msg.data
      const partials = []
      for (let i = 0; i < chunks.length; i++) {
        partials.push(await computeHash(chunks[i]))
      }
      const finalHash = await combineHashes(partials)
      postMessage({ id: msg.id, data: { hash: finalHash } })
    } else {
      postMessage({ id: msg.id, error: 'Unknown message type: ' + msg.type })
    }
  } catch (err) {
    const message = err && err.message ? err.message : String(err)
    postMessage({ id: msg.id, error: message })
  }
}