import { calcChunkHash } from './chunk'
import type { Chunk } from './chunk'

onmessage = function (e) {
  const chunks = e.data as Chunk[]
  for (const chunk of chunks) {
    calcChunkHash(chunk).then((hash) => {
      chunk.hash = hash
      postMessage([chunk])
    })
  }
}
