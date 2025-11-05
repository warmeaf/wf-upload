# 配置选项

`FileUploader` 接受一个配置对象，包含上传相关的所有配置项。

## UploadConfig

```typescript
interface UploadConfig {
  chunkSize: number              // 分片大小（字节）
  concurrency: number            // 并发上传数
  baseUrl: string                // 后端 API 基础地址
  enableMultiThreading?: boolean // 是否启用多线程 Hash 计算（默认 true）
}
```

## 配置项说明

### chunkSize

- **类型**: `number`
- **必填**: 是
- **说明**: 文件分片大小，单位字节
- **推荐值**: `2 * 1024 * 1024` (2MB) 或 `5 * 1024 * 1024` (5MB)
- **注意**: 
  - 分片太小会增加请求次数，影响性能
  - 分片太大会影响断点续传的粒度
  - 建议根据文件大小和网络环境调整

```typescript
const uploader = new FileUploader({
  config: {
    chunkSize: 2 * 1024 * 1024, // 2MB
    // ...
  },
})
```

### concurrency

- **类型**: `number`
- **必填**: 是
- **说明**: 同时上传的分片数量
- **推荐值**: `3` - `5`
- **注意**:
  - 并发数过低会降低上传速度
  - 并发数过高可能导致服务器压力过大
  - 建议根据服务器性能和网络带宽调整

```typescript
const uploader = new FileUploader({
  config: {
    concurrency: 3, // 同时上传 3 个分片
    // ...
  },
})
```

### baseUrl

- **类型**: `string`
- **必填**: 是
- **说明**: 后端 API 的基础地址
- **格式**: `http://localhost:3000/api/file` 或 `https://api.example.com/file`
- **注意**: 确保地址正确，否则会导致上传失败

```typescript
const uploader = new FileUploader({
  config: {
    baseUrl: 'http://localhost:3000/api/file',
    // ...
  },
})
```

### enableMultiThreading

- **类型**: `boolean`
- **必填**: 否
- **默认值**: `true`
- **说明**: 是否启用多线程 Hash 计算
- **注意**:
  - 启用后使用 Web Workers 线程池并行计算 Hash，不阻塞主线程
  - 禁用后在主线程顺序计算 Hash，可能阻塞页面
  - 建议保持默认值 `true`

```typescript
const uploader = new FileUploader({
  config: {
    enableMultiThreading: true, // 启用多线程（默认）
    // ...
  },
})
```

## 完整配置示例

```typescript
import { FileUploader } from '@wf-upload/core'

const uploader = new FileUploader({
  config: {
    // 分片大小：5MB（适合大文件）
    chunkSize: 5 * 1024 * 1024,
    
    // 并发数：5（充分利用带宽）
    concurrency: 5,
    
    // API 地址
    baseUrl: 'https://api.example.com/file',
    
    // 启用多线程 Hash 计算
    enableMultiThreading: true,
  },
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
```

## 根据文件大小动态配置

```typescript
function createUploader(file: File) {
  // 根据文件大小动态调整配置
  const fileSizeMB = file.size / (1024 * 1024)
  
  let chunkSize = 2 * 1024 * 1024 // 默认 2MB
  let concurrency = 3 // 默认并发数 3
  
  if (fileSizeMB > 100) {
    // 大于 100MB，使用更大的分片和更高的并发
    chunkSize = 5 * 1024 * 1024 // 5MB
    concurrency = 5
  } else if (fileSizeMB > 500) {
    // 大于 500MB，进一步优化
    chunkSize = 10 * 1024 * 1024 // 10MB
    concurrency = 6
  }
  
  return new FileUploader({
    config: {
      chunkSize,
      concurrency,
      baseUrl: 'http://localhost:3000/api/file',
    },
    // ...
  })
}
```

## 环境变量配置

在生产环境中，建议使用环境变量配置 API 地址：

```typescript
const uploader = new FileUploader({
  config: {
    chunkSize: 2 * 1024 * 1024,
    concurrency: 3,
    baseUrl: process.env.VITE_API_BASE_URL || 'http://localhost:3000/api/file',
  },
  // ...
})
```
