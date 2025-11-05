# 类型定义

wf-upload 提供了完整的 TypeScript 类型定义。

## 导入类型

```typescript
import type {
  FileInfo,
  ChunkInfo,
  UploadConfig,
  UploaderState,
  // ... 其他类型
} from '@wf-upload/core'
```

## 核心类型

### FileInfo

文件基本信息。

```typescript
interface FileInfo {
  name: string  // 文件名
  size: number  // 文件大小（字节）
  type: string  // 文件类型（MIME）
}
```

### ChunkInfo

分片信息。

```typescript
interface ChunkInfo {
  index: number  // 分片索引
  start: number  // 起始位置（字节）
  end: number    // 结束位置（字节）
  size: number   // 分片大小（字节）
  blob: Blob     // 分片数据
  hash?: string  // 分片 Hash（可选）
}
```

### UploadConfig

上传配置。

```typescript
interface UploadConfig {
  chunkSize: number              // 分片大小（字节）
  concurrency: number            // 并发上传数
  baseUrl: string                // 后端 API 基础地址
  enableMultiThreading?: boolean // 是否启用多线程 Hash 计算（默认 true）
}
```

### UploaderState

上传器状态。

```typescript
interface UploaderState {
  status: 'idle' | 'uploading' | 'completed' | 'failed'
  token?: string                    // 上传会话 token
  fileHash?: string                 // 文件 Hash 值
  progress: {
    chunksHashed: number            // 已计算 Hash 的分片数
    chunksUploaded: number          // 已上传的分片数
    totalChunks: number             // 总分片数
  }
  error?: Error                     // 错误信息（如果有）
  downloadUrl?: string              // 下载地址（上传完成后）
  chunksHashDuration?: number      // 分片 Hash 计算耗时（毫秒）
}
```

## 事件类型

### ChunkHashedEvent

分片 Hash 计算完成事件。

```typescript
interface ChunkHashedEvent {
  type: 'ChunkHashed'
  chunk: ChunkInfo & { hash: string }
}
```

### AllChunksHashedEvent

所有分片 Hash 计算完成事件。

```typescript
interface AllChunksHashedEvent {
  type: 'AllChunksHashed'
}
```

### FileHashedEvent

文件 Hash 计算完成事件。

```typescript
interface FileHashedEvent {
  type: 'FileHashed'
  fileHash: string
}
```

### QueueDrainedEvent

上传队列排空事件（所有分片上传完成）。

```typescript
interface QueueDrainedEvent {
  type: 'QueueDrained'
}
```

### QueueAbortedEvent

上传队列中止事件。

```typescript
interface QueueAbortedEvent {
  type: 'QueueAborted'
  error: Error
}
```

### UploadEvent

所有上传事件的联合类型。

```typescript
type UploadEvent =
  | ChunkHashedEvent
  | AllChunksHashedEvent
  | FileHashedEvent
  | QueueDrainedEvent
  | QueueAbortedEvent
```

## API 类型

### CreateFileRequest

创建文件会话请求。

```typescript
interface CreateFileRequest {
  fileName: string      // 文件名
  fileSize: number      // 文件大小
  fileType: string      // 文件类型
  chunksLength: number // 分片数量
}
```

### CreateFileResponse

创建文件会话响应。

```typescript
interface CreateFileResponse {
  code: 200
  token: string  // 上传会话 token
}
```

### PatchHashRequest

Hash 检测请求。

```typescript
interface PatchHashRequest {
  token: string   // 上传会话 token
  hash: string    // Hash 值
  isChunk: boolean // 是否为分片 Hash
}
```

### PatchHashResponse

Hash 检测响应。

```typescript
interface PatchHashResponse {
  code: 200
  exists: boolean  // 是否存在
}
```

### UploadChunkRequest

上传分片请求。

```typescript
interface UploadChunkRequest {
  token: string  // 上传会话 token
  hash: string   // 分片 Hash
  // blob 通过 FormData 传递
}
```

### UploadChunkResponse

上传分片响应。

```typescript
interface UploadChunkResponse {
  code: 200
  success: boolean
}
```

### MergeFileRequest

合并文件请求。

```typescript
interface MergeFileRequest {
  token: string      // 上传会话 token
  fileHash: string   // 文件 Hash
  fileName: string   // 文件名
  chunksLength: number // 分片数量
  chunks: ChunkDto[]   // 分片信息数组
}
```

### ChunkDto

分片数据传输对象。

```typescript
interface ChunkDto {
  index: number  // 分片索引
  hash: string   // 分片 Hash
}
```

### MergeFileResponse

合并文件响应。

```typescript
interface MergeFileResponse {
  code: 200
  url: string  // 文件访问地址
}
```

## 事件监听器类型

### EventListener

事件监听器函数类型。

```typescript
type EventListener<T = any> = (event: T) => void
```

### EventEmitter

事件发射器接口。

```typescript
interface EventEmitter {
  on<T extends UploadEvent>(
    eventType: T['type'],
    listener: EventListener<T>
  ): void
  off<T extends UploadEvent>(
    eventType: T['type'],
    listener: EventListener<T>
  ): void
  emit<T extends UploadEvent>(event: T): void
}
```

## Worker 消息类型

### WorkerStartMessage

Worker 启动消息。

```typescript
interface WorkerStartMessage {
  type: 'start'
  file: File
  chunkSize: number
}
```

### WorkerChunkHashedMessage

Worker 分片 Hash 计算完成消息。

```typescript
interface WorkerChunkHashedMessage {
  type: 'chunkHashed'
  chunk: ChunkInfo & { hash: string }
}
```

### WorkerAllChunksHashedMessage

Worker 所有分片 Hash 计算完成消息。

```typescript
interface WorkerAllChunksHashedMessage {
  type: 'allChunksHashed'
}
```

### WorkerFileHashedMessage

Worker 文件 Hash 计算完成消息。

```typescript
interface WorkerFileHashedMessage {
  type: 'fileHashed'
  fileHash: string
}
```

### WorkerErrorMessage

Worker 错误消息。

```typescript
interface WorkerErrorMessage {
  type: 'error'
  error: string
}
```

### WorkerMessage

所有 Worker 消息的联合类型。

```typescript
type WorkerMessage =
  | WorkerChunkHashedMessage
  | WorkerAllChunksHashedMessage
  | WorkerFileHashedMessage
  | WorkerErrorMessage
```

## 队列类型

### QueueStats

队列统计信息。

```typescript
interface QueueStats {
  totalChunks: number      // 总分片数
  pending: number          // 等待中的分片数
  inFlight: number         // 正在上传的分片数
  completed: number        // 已完成的分片数
  failed: number           // 失败的分片数
  allChunksHashed: boolean // 是否所有分片 Hash 已计算
}
```

### QueueTask

队列任务。

```typescript
interface QueueTask {
  chunk: ChunkInfo & { hash: string }
  status: 'pending' | 'inFlight' | 'completed' | 'failed'
  error?: Error
}
```

## 使用示例

```typescript
import type {
  FileUploaderOptions,
  UploadConfig,
  UploaderState,
  ChunkHashedEvent,
} from '@wf-upload/core'

// 使用类型定义
const config: UploadConfig = {
  chunkSize: 2 * 1024 * 1024,
  concurrency: 3,
  baseUrl: 'http://localhost:3000/api/file',
}

const options: FileUploaderOptions = {
  config,
  onProgress: (state: UploaderState) => {
    // TypeScript 会自动推断 state 类型
  },
}

// 事件类型
uploader.on<ChunkHashedEvent>('ChunkHashed', (event) => {
  // TypeScript 会自动推断 event 类型
  console.log(event.chunk.hash)
})
```
