# 断点续传

断点续传是指在上传过程中如果中断（网络断开、页面刷新等），下次继续上传时可以从上次中断的地方继续，而无需重新上传已完成的分片。

## 工作原理

wf-upload 通过以下机制实现断点续传：

1. **分片 Hash 计算**: 每个分片都有唯一的 Hash 值（MD5）
2. **分片检测**: 上传前会先检测分片是否已在服务器上存在
3. **跳过已存在**: 如果分片已存在，则跳过上传，直接标记为完成
4. **仅上传缺失**: 只上传服务器上不存在的分片

## 自动断点续传

断点续传功能是自动启用的，无需额外配置：

```typescript
import { FileUploader } from '@wf-upload/core'

const uploader = new FileUploader({
  config: {
    chunkSize: 2 * 1024 * 1024, // 2MB 分片
    concurrency: 3,
    baseUrl: 'http://localhost:3000/api/file',
  },
  onProgress: (state) => {
    const { chunksUploaded, totalChunks } = state.progress
    console.log(`已上传: ${chunksUploaded}/${totalChunks}`)
  },
})

await uploader.upload(file)
```

## 断点续传流程

1. **创建会话**: 调用 `/file/create` 创建上传会话
2. **计算分片 Hash**: 并行计算所有分片的 Hash 值
3. **检测分片**: 对每个分片调用 `/file/patchHash` 检测是否已存在
4. **选择性上传**: 
   - 已存在的分片：跳过上传，直接标记为完成
   - 不存在的分片：加入上传队列，进行实际上传
5. **合并文件**: 所有分片就绪后，调用 `/file/merge` 合并文件

## 示例：断点续传场景

### 场景 1: 网络中断后继续上传

```typescript
let uploader: FileUploader | null = null

// 第一次上传（中断）
async function firstUpload(file: File) {
  uploader = new FileUploader({
    config: {
      chunkSize: 2 * 1024 * 1024,
      concurrency: 3,
      baseUrl: 'http://localhost:3000/api/file',
    },
    onProgress: (state) => {
      console.log(`进度: ${state.progress.chunksUploaded}/${state.progress.totalChunks}`)
    },
  })
  
  try {
    await uploader.upload(file)
  } catch (error) {
    console.log('上传中断，已上传的分片会保留在服务器')
  }
}

// 第二次上传（续传）
async function resumeUpload(file: File) {
  // 创建新的上传器实例
  uploader = new FileUploader({
    config: {
      chunkSize: 2 * 1024 * 1024, // 必须使用相同的分片大小
      concurrency: 3,
      baseUrl: 'http://localhost:3000/api/file',
    },
  })
  
  // 重新上传相同文件，会自动检测已存在的分片
  await uploader.upload(file)
  // 只会上传上次未完成的分片
}
```

### 场景 2: 页面刷新后继续上传

```typescript
// 保存上传进度
function saveProgress(state: UploaderState) {
  localStorage.setItem('uploadProgress', JSON.stringify({
    fileName: state.fileHash, // 使用文件 Hash 作为标识
    chunksUploaded: state.progress.chunksUploaded,
    totalChunks: state.progress.totalChunks,
  }))
}

// 恢复上传
async function resumeAfterRefresh(file: File) {
  const uploader = new FileUploader({
    config: {
      chunkSize: 2 * 1024 * 1024,
      concurrency: 3,
      baseUrl: 'http://localhost:3000/api/file',
    },
    onProgress: (state) => {
      saveProgress(state)
    },
  })
  
  // 上传时会自动检测已存在的分片
  await uploader.upload(file)
}
```

## 分片检测机制

每个分片在上传前都会进行检测：

```typescript
const uploader = new FileUploader({
  config: { /* ... */ },
})

uploader.on('ChunkHashed', async (event) => {
  // 分片 Hash 计算完成后，会自动检测分片是否存在
  // 如果存在，则跳过上传；如果不存在，则加入上传队列
  console.log(`分片 ${event.chunk.index} Hash: ${event.chunk.hash}`)
})
```

## 注意事项

### 1. 分片大小必须一致

断点续传要求每次上传使用相同的分片大小，否则分片 Hash 会不同，无法正确识别已上传的分片。

```typescript
// ✅ 正确：使用相同的分片大小
const chunkSize = 2 * 1024 * 1024 // 2MB

// ❌ 错误：每次使用不同的分片大小
const chunkSize1 = 2 * 1024 * 1024 // 第一次
const chunkSize2 = 5 * 1024 * 1024 // 第二次（错误！）
```

### 2. 文件内容必须相同

断点续传基于文件 Hash，如果文件内容发生变化，Hash 也会变化，无法续传。

### 3. 后端支持

断点续传依赖后端实现：
- 后端需要存储分片 Hash 和分片数据
- 后端需要提供分片检测接口 (`/file/patchHash`)
- 后端需要支持分片去重存储

### 4. 会话管理

- 每次上传都会创建新的会话（token）
- 已上传的分片永久保留在服务器（直到被清理）
- 不同的上传会话可以共享相同的分片数据

## 性能优势

断点续传带来的性能优势：

- **节省带宽**: 避免重复上传已完成的分片
- **节省时间**: 大幅缩短上传时间
- **提升体验**: 用户可以随时中断和恢复上传
- **降低服务器压力**: 减少重复数据传输

## 最佳实践

1. **固定分片大小**: 在应用中使用固定的分片大小配置
2. **保存进度**: 可以保存上传进度，但断点续传会自动处理
3. **错误处理**: 正确处理上传错误，用户可以重试
4. **用户体验**: 显示"续传中"状态，让用户知道正在使用断点续传
