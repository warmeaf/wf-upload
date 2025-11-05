# FileUploader API

`FileUploader` 是 wf-upload 的核心类，负责协调整个文件上传流程。

## 导入

```typescript
import { FileUploader } from '@wf-upload/core'
```

## 构造函数

```typescript
new FileUploader(options: FileUploaderOptions)
```

### FileUploaderOptions

```typescript
interface FileUploaderOptions {
  config: UploadConfig // 上传配置
  onProgress?: (state: UploaderState) => void // 进度回调
  onCompleted?: (url: string) => void // 完成回调
  onError?: (error: Error) => void // 错误回调
}
```

### UploadConfig

```typescript
interface UploadConfig {
  chunkSize: number // 分片大小(字节)
  concurrency: number // 并发上传数
  baseUrl: string // 后端 API 基础地址
  enableMultiThreading?: boolean // 是否启用多线程 Hash 计算(默认 true)
}
```

## 方法

### upload(file: File): Promise&lt;void&gt;

开始上传文件。

**参数：**

- `file: File` - 要上传的文件对象

**返回：**

- `Promise&lt;void&gt;` - 上传完成的 Promise

**示例：**

```typescript
const uploader = new FileUploader({
  config: {
    /* ... */
  },
})

await uploader.upload(file)
```

**错误：**

- 如果文件为空或大小为 0，会抛出错误
- 如果上传过程中发生错误，Promise 会被 reject

### getState(): UploaderState

获取当前的上传状态。

**返回：**

- `UploaderState` - 当前状态对象

**示例：**

```typescript
const state = uploader.getState()
console.log('当前状态:', state.status)
console.log('进度:', state.progress)
```

### abort(): void

取消正在进行的上传。

**示例：**

```typescript
uploader.abort()
// 取消后，状态会变为 'failed'，并触发 onError 回调
```

**注意：**

- 取消操作不可逆
- 取消后会终止所有正在进行的上传请求
- Worker 线程会被终止

### on&lt;T&gt;(eventType: string, listener: (event: T) => void): void

监听事件。

**参数：**

- `eventType: string` - 事件类型
- `listener: (event: T) => void` - 事件监听器

**示例：**

```typescript
uploader.on('ChunkHashed', (event) => {
  console.log('分片 Hash:', event.chunk.hash)
})
```

### off&lt;T&gt;(eventType: string, listener: (event: T) => void): void

取消事件监听。

**参数：**

- `eventType: string` - 事件类型
- `listener: (event: T) => void` - 要移除的监听器

**示例：**

```typescript
const handler = (event: ChunkHashedEvent) => {
  console.log('分片 Hash:', event.chunk.hash)
}

uploader.on('ChunkHashed', handler)
// 稍后取消监听
uploader.off('ChunkHashed', handler)
```

### emit&lt;T&gt;(event: T & { type: string }): void

触发事件（内部使用，通常不需要直接调用）。

## 事件

`FileUploader` 实现了 `EventEmitter` 接口，支持以下事件：

- `ChunkHashed` - 分片 Hash 计算完成
- `AllChunksHashed` - 所有分片 Hash 计算完成
- `FileHashed` - 文件 Hash 计算完成
- `QueueDrained` - 所有分片上传完成
- `QueueAborted` - 上传队列被中止

详见 [事件类型文档](./events.md)。

## 状态

### UploaderState

```typescript
interface UploaderState {
  status: 'idle' | 'uploading' | 'completed' | 'failed'
  token?: string // 上传会话 token
  fileHash?: string // 文件 Hash 值
  progress: {
    chunksHashed: number // 已计算 Hash 的分片数
    chunksUploaded: number // 已上传的分片数
    totalChunks: number // 总分片数
  }
  error?: Error // 错误信息(如果有)
  downloadUrl?: string // 下载地址(上传完成后)
  chunksHashDuration?: number // 分片 Hash 计算耗时(毫秒)
}
```

### status 状态说明

- `idle` - 空闲状态，尚未开始上传
- `uploading` - 正在上传
- `completed` - 上传完成
- `failed` - 上传失败

## 完整示例

```typescript
import { FileUploader, type UploaderState } from '@wf-upload/core'

const uploader = new FileUploader({
  config: {
    chunkSize: 2 * 1024 * 1024,
    concurrency: 3,
    baseUrl: 'http://localhost:3000/api/file',
    enableMultiThreading: true,
  },
  onProgress: (state: UploaderState) => {
    console.log('状态:', state.status)
    console.log('进度:', state.progress)
  },
  onCompleted: (url: string) => {
    console.log('上传完成:', url)
  },
  onError: (error: Error) => {
    console.error('上传错误:', error)
  },
})

// 监听事件
uploader.on('ChunkHashed', (event) => {
  console.log('分片 Hash 计算完成:', event.chunk.hash)
})

uploader.on('FileHashed', (event) => {
  console.log('文件 Hash:', event.fileHash)
})

// 开始上传
try {
  await uploader.upload(file)
  const finalState = uploader.getState()
  console.log('最终状态:', finalState)
} catch (error) {
  console.error('上传失败:', error)
}
```

## 注意事项

1. **单次使用**: 每个 `FileUploader` 实例设计用于上传单个文件
2. **文件对象**: `upload()` 方法接受标准的 `File` 对象
3. **异步操作**: `upload()` 方法是异步的，需要使用 `await` 或 `.then()`
4. **错误处理**: 建议始终提供 `onError` 回调
5. **资源清理**: 上传完成后，上传器会自动清理资源
