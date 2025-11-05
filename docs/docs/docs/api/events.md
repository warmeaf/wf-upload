# 事件类型

`FileUploader` 实现了完整的事件系统，支持监听上传过程中的各种事件。

## 事件列表

### ChunkHashed

当某个分片的 Hash 计算完成时触发。

**事件类型：**
```typescript
interface ChunkHashedEvent {
  type: 'ChunkHashed'
  chunk: ChunkInfo & { hash: string }
}
```

**chunk 属性：**
- `index: number` - 分片索引
- `start: number` - 起始位置
- `end: number` - 结束位置
- `size: number` - 分片大小
- `blob: Blob` - 分片数据
- `hash: string` - 分片 Hash 值

**示例：**
```typescript
uploader.on('ChunkHashed', (event) => {
  console.log(`分片 ${event.chunk.index} Hash: ${event.chunk.hash}`)
  console.log(`分片大小: ${event.chunk.size} 字节`)
})
```

### AllChunksHashed

当所有分片的 Hash 计算完成时触发。

**事件类型：**
```typescript
interface AllChunksHashedEvent {
  type: 'AllChunksHashed'
}
```

**示例：**
```typescript
uploader.on('AllChunksHashed', () => {
  console.log('✅ 所有分片 Hash 计算完成')
})
```

**注意：**
- 此事件不包含文件完整 Hash，文件 Hash 可能还未计算完成
- 所有分片 Hash 计算完成后，分片会开始上传

### FileHashed

当文件完整 Hash 计算完成时触发。

**事件类型：**
```typescript
interface FileHashedEvent {
  type: 'FileHashed'
  fileHash: string
}
```

**示例：**
```typescript
uploader.on('FileHashed', (event) => {
  console.log('📄 文件 Hash:', event.fileHash)
  // 此时会检测文件是否存在，如果存在则触发秒传
})
```

**注意：**
- 文件 Hash 计算可能在所有分片 Hash 计算完成后进行
- 如果启用了增量 Hash 计算，文件 Hash 可能在分片上传过程中计算

### QueueDrained

当所有分片上传完成时触发。

**事件类型：**
```typescript
interface QueueDrainedEvent {
  type: 'QueueDrained'
}
```

**示例：**
```typescript
uploader.on('QueueDrained', () => {
  console.log('✅ 所有分片上传完成，准备合并文件')
})
```

**注意：**
- 此事件触发后，会调用后端合并文件接口
- 合并完成后会触发 `onCompleted` 回调

### QueueAborted

当上传队列被中止时触发（通常是取消上传或发生错误）。

**事件类型：**
```typescript
interface QueueAbortedEvent {
  type: 'QueueAborted'
  error: Error
}
```

**示例：**
```typescript
uploader.on('QueueAborted', (event) => {
  console.error('❌ 上传中止:', event.error.message)
})
```

**触发场景：**
- 调用 `abort()` 方法取消上传
- 上传过程中发生错误
- 网络请求失败

## 事件流程

典型的上传事件流程：

```
1. ChunkHashed (分片 0 Hash 计算完成)
2. ChunkHashed (分片 1 Hash 计算完成)
3. ChunkHashed (分片 2 Hash 计算完成)
...
N. AllChunksHashed (所有分片 Hash 计算完成)
N+1. FileHashed (文件 Hash 计算完成，可选)
N+2. QueueDrained (所有分片上传完成)
```

**秒传场景：**
```
1. ChunkHashed (多个分片)
2. AllChunksHashed
3. FileHashed
4. QueueDrained (秒传，分片未实际上传)
```

**错误场景：**
```
1. ChunkHashed (多个分片)
2. QueueAborted (发生错误)
```

## 使用示例

### 基础用法

```typescript
import { FileUploader } from '@wf-upload/core'

const uploader = new FileUploader({
  config: {
    chunkSize: 2 * 1024 * 1024,
    concurrency: 3,
    baseUrl: 'http://localhost:3000/api/file',
  },
})

// 监听所有事件
uploader.on('ChunkHashed', (event) => {
  console.log(`分片 ${event.chunk.index} Hash: ${event.chunk.hash}`)
})

uploader.on('AllChunksHashed', () => {
  console.log('所有分片 Hash 计算完成')
})

uploader.on('FileHashed', (event) => {
  console.log('文件 Hash:', event.fileHash)
})

uploader.on('QueueDrained', () => {
  console.log('所有分片上传完成')
})

uploader.on('QueueAborted', (event) => {
  console.error('上传中止:', event.error)
})

await uploader.upload(file)
```

### TypeScript 类型安全

```typescript
import type {
  ChunkHashedEvent,
  AllChunksHashedEvent,
  FileHashedEvent,
  QueueDrainedEvent,
  QueueAbortedEvent,
} from '@wf-upload/core'

uploader.on<ChunkHashedEvent>('ChunkHashed', (event) => {
  // TypeScript 会自动推断 event 类型
  console.log(event.chunk.hash)
})

uploader.on<FileHashedEvent>('FileHashed', (event) => {
  // TypeScript 会自动推断 event 类型
  console.log(event.fileHash)
})
```

### 取消事件监听

```typescript
const handler = (event: ChunkHashedEvent) => {
  console.log('分片 Hash:', event.chunk.hash)
}

// 添加监听
uploader.on('ChunkHashed', handler)

// 取消监听
uploader.off('ChunkHashed', handler)
```

### 条件监听

```typescript
let hashCount = 0

uploader.on('ChunkHashed', (event) => {
  hashCount++
  console.log(`已计算 ${hashCount} 个分片 Hash`)
  
  // 达到某个条件后取消监听
  if (hashCount >= 10) {
    uploader.off('ChunkHashed', handler)
  }
})
```

## 与回调的关系

事件系统和回调系统是独立的，可以同时使用：

```typescript
const uploader = new FileUploader({
  config: { /* ... */ },
  // 使用回调
  onProgress: (state) => {
    console.log('进度:', state.progress)
  },
  onCompleted: (url) => {
    console.log('完成:', url)
  },
  onError: (error) => {
    console.error('错误:', error)
  },
})

// 同时使用事件
uploader.on('ChunkHashed', (event) => {
  console.log('分片 Hash:', event.chunk.hash)
})
```

**建议：**
- 简单场景使用回调（`onProgress`, `onCompleted`, `onError`）
- 需要详细事件信息时使用事件系统
- 两者可以同时使用，互不冲突

## 注意事项

1. **事件顺序**: 事件按顺序触发，但可能因为并发而交错
2. **事件类型**: 使用 TypeScript 时，建议使用类型参数确保类型安全
3. **内存泄漏**: 记得在不需要时取消事件监听，避免内存泄漏
4. **错误处理**: `QueueAborted` 事件会携带错误信息，需要正确处理
