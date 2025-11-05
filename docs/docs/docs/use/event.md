# 事件监听

`FileUploader` 实现了事件系统，支持监听上传过程中的各种事件。

## 事件系统

`FileUploader` 实现了 `EventEmitter` 接口，支持以下方法：

- `on(eventType, listener)` - 监听事件
- `off(eventType, listener)` - 取消监听
- `emit(event)` - 触发事件（内部使用）

## 可用事件

### ChunkHashed

当某个分片的 Hash 计算完成时触发。

```typescript
import { FileUploader } from '@wf-upload/core'

uploader.on('ChunkHashed', (event) => {
  console.log('分片 Hash 计算完成:', event.chunk)
  // event.chunk: { index, start, end, size, blob, hash }
})
```

### AllChunksHashed

当所有分片的 Hash 计算完成时触发。

```typescript
uploader.on('AllChunksHashed', (event) => {
  console.log('所有分片 Hash 计算完成')
})
```

### FileHashed

当文件完整 Hash 计算完成时触发。

```typescript
uploader.on('FileHashed', (event) => {
  console.log('文件 Hash:', event.fileHash)
})
```

### QueueDrained

当所有分片上传完成时触发。

```typescript
uploader.on('QueueDrained', (event) => {
  console.log('所有分片上传完成，准备合并文件')
})
```

### QueueAborted

当上传队列被中止时触发（通常是取消上传或发生错误）。

```typescript
uploader.on('QueueAborted', (event) => {
  console.error('上传中止:', event.error)
})
```

## 使用回调 vs 事件监听

`FileUploader` 提供了两种方式来监听上传状态：

### 1. 回调方式（推荐）

使用构造函数选项中的回调函数，简单直接：

```typescript
const uploader = new FileUploader({
  config: { /* ... */ },
  onProgress: (state) => {
    // 进度更新
  },
  onCompleted: (url) => {
    // 上传完成
  },
  onError: (error) => {
    // 错误处理
  },
})
```

### 2. 事件监听方式

使用事件系统，更灵活但需要手动管理：

```typescript
const uploader = new FileUploader({
  config: { /* ... */ },
})

uploader.on('ChunkHashed', (event) => {
  console.log('分片 Hash:', event.chunk.hash)
})

uploader.on('QueueDrained', () => {
  console.log('上传完成')
})

uploader.on('QueueAborted', (event) => {
  console.error('上传失败:', event.error)
})
```

## 完整示例

```typescript
import { FileUploader } from '@wf-upload/core'

const uploader = new FileUploader({
  config: {
    chunkSize: 2 * 1024 * 1024,
    concurrency: 3,
    baseUrl: 'http://localhost:3000/api/file',
  },
})

// 监听各个事件
uploader.on('ChunkHashed', (event) => {
  console.log(`分片 ${event.chunk.index} Hash 计算完成:`, event.chunk.hash)
})

uploader.on('AllChunksHashed', () => {
  console.log('✅ 所有分片 Hash 计算完成')
})

uploader.on('FileHashed', (event) => {
  console.log('📄 文件 Hash:', event.fileHash)
})

uploader.on('QueueDrained', () => {
  console.log('✅ 所有分片上传完成')
})

uploader.on('QueueAborted', (event) => {
  console.error('❌ 上传中止:', event.error.message)
})

// 开始上传
await uploader.upload(file)
```

## 取消事件监听

```typescript
const handler = (event: ChunkHashedEvent) => {
  console.log('分片 Hash:', event.chunk.hash)
}

// 添加监听
uploader.on('ChunkHashed', handler)

// 取消监听
uploader.off('ChunkHashed', handler)
```

## 事件类型定义

所有事件类型都已导出，可以在 TypeScript 中使用：

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
```
