# 大文件上传前端库

一个高性能的大文件分片上传前端库，支持断点续传、秒传、并发控制等功能。

## 技术栈

- **TypeScript** - 类型安全的开发体验
- **Web Workers** - 在 Worker 线程中进行 Hash 计算，避免阻塞主线程
- **SparkMD5** - 用于计算文件分片和完整文件的 MD5 哈希值
- **Fetch API** - 现代化的 HTTP 请求接口
- **EventEmitter 模式** - 事件驱动的架构设计，支持灵活的事件监听

## 核心特性

- ✅ **分片上传** - 将大文件分割成多个小块进行上传
- ✅ **断点续传** - 自动检测已上传的分片，跳过重复上传
- ✅ **秒传功能** - 通过文件 Hash 值检测文件是否已存在
- ✅ **并发控制** - 可配置的并发上传数量
- ✅ **进度追踪** - 实时获取上传进度信息
- ✅ **错误处理** - 完善的错误处理机制
- ✅ **事件系统** - 支持监听各种上传事件

## 使用示例

### 基础使用

```typescript
import { createUploaderWithDefaults } from '@wf-upload/core'

const uploader = createUploaderWithDefaults({
  config: {
    baseUrl: 'https://api.example.com',
    chunkSize: 2 * 1024 * 1024, // 2MB
    concurrency: 3, // 并发数
  },
  onProgress: (state) => {
    const { progress, status } = state
    const hashProgress = (progress.chunksHashed / progress.totalChunks) * 100
    const uploadProgress =
      (progress.chunksUploaded / progress.totalChunks) * 100

    console.log(`Hash 进度: ${hashProgress.toFixed(2)}%`)
    console.log(`上传进度: ${uploadProgress.toFixed(2)}%`)
    console.log(`状态: ${status}`)
  },
  onCompleted: (downloadUrl) => {
    console.log('上传完成！下载地址:', downloadUrl)
  },
  onError: (error) => {
    console.error('上传失败:', error.message)
  },
})

// 上传文件
const fileInput = document.querySelector('input[type="file"]')
fileInput.addEventListener('change', async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (file) {
    await uploader.upload(file)
  }
})
```

### 自定义配置

```typescript
import { FileUploader } from '@wf-upload/core'
import type { FileUploaderOptions } from '@wf-upload/core'

const options: FileUploaderOptions = {
  config: {
    baseUrl: '/api',
    chunkSize: 5 * 1024 * 1024, // 5MB 分片大小
    concurrency: 5, // 5个并发上传
  },
  onProgress: (state) => {
    // 处理进度更新
  },
  onCompleted: (downloadUrl) => {
    // 处理完成事件
  },
  onError: (error) => {
    // 处理错误
  },
}

const uploader = new FileUploader(options)
```

### 事件监听

```typescript
import { FileUploader } from '@wf-upload/core'
import type {
  ChunkHashedEvent,
  FileHashedEvent,
  QueueDrainedEvent,
} from '@wf-upload/core'

const uploader = new FileUploader({
  config: {
    baseUrl: '/api',
    chunkSize: 2 * 1024 * 1024,
    concurrency: 3,
  },
})

// 监听分片 Hash 计算完成事件
uploader.on<ChunkHashedEvent>('ChunkHashed', (event) => {
  console.log('分片 Hash 计算完成:', event.chunk)
})

// 监听文件 Hash 计算完成事件
uploader.on<FileHashedEvent>('FileHashed', (event) => {
  console.log('文件 Hash:', event.fileHash)
})

// 监听队列完成事件
uploader.on<QueueDrainedEvent>('QueueDrained', () => {
  console.log('所有分片上传完成')
})

// 上传文件
await uploader.upload(file)
```

### 获取上传状态

```typescript
const state = uploader.getState()

console.log('当前状态:', state.status) // 'idle' | 'uploading' | 'completed' | 'failed'
console.log('Token:', state.token)
console.log('文件 Hash:', state.fileHash)
console.log('下载地址:', state.downloadUrl)
console.log('进度:', state.progress)
```

### 取消上传

```typescript
// 取消正在进行的上传
uploader.abort()
```

## API 参考

### FileUploaderOptions

```typescript
interface FileUploaderOptions {
  config: {
    chunkSize: number // 分片大小（字节）
    concurrency: number // 并发上传数量
    baseUrl: string // API 基础 URL
  }
  onProgress?: (state: UploaderState) => void
  onCompleted?: (downloadUrl: string) => void
  onError?: (error: Error) => void
}
```

### 方法

- `upload(file: File): Promise<void>` - 开始上传文件
- `abort(): void` - 取消上传
- `getState(): UploaderState` - 获取当前上传状态
- `on<T>(eventType: string, listener: (event: T) => void): void` - 监听事件
- `off<T>(eventType: string, listener: (event: T) => void): void` - 取消监听事件

### 事件类型

- `ChunkHashed` - 分片 Hash 计算完成
- `AllChunksHashed` - 所有分片 Hash 计算完成
- `FileHashed` - 文件 Hash 计算完成
- `QueueDrained` - 上传队列完成
- `QueueAborted` - 上传队列中止
