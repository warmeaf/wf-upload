# 文件秒传

文件秒传是指当上传的文件已经在服务器上存在时，无需实际上传文件数据，直接完成上传过程的功能。

## 工作原理

wf-upload 通过以下机制实现文件秒传：

1. **文件 Hash 计算**: 在上传过程中，会计算整个文件的 MD5 Hash 值
2. **Hash 检测**: 计算完成后，会向服务器查询该 Hash 值对应的文件是否已存在
3. **秒传判断**: 如果文件已存在，则跳过所有分片的上传，直接完成上传流程

## 自动秒传

秒传功能是自动启用的，无需额外配置：

```typescript
import { FileUploader } from '@wf-upload/core'

const uploader = new FileUploader({
  config: {
    chunkSize: 2 * 1024 * 1024,
    concurrency: 3,
    baseUrl: 'http://localhost:3000/api/file',
  },
  onProgress: (state) => {
    console.log('状态:', state.status)
    console.log('文件 Hash:', state.fileHash)
  },
  onCompleted: (url) => {
    console.log('上传完成（可能是秒传）:', url)
  },
})

await uploader.upload(file)
```

## 秒传流程

1. **开始上传**: 调用 `upload()` 方法
2. **创建会话**: 向服务器创建上传会话，获取 token
3. **计算 Hash**: 使用 Web Workers 并行计算文件 Hash
4. **检测文件**: 文件 Hash 计算完成后，调用 `/file/patchHash` 接口检测文件是否存在
5. **秒传处理**: 
   - 如果文件存在：跳过所有分片上传，直接完成
   - 如果文件不存在：继续正常的分片上传流程

## 监听秒传事件

可以通过事件监听来检测是否发生了秒传：

```typescript
const uploader = new FileUploader({
  config: { /* ... */ },
})

uploader.on('FileHashed', async (event) => {
  console.log('文件 Hash 计算完成:', event.fileHash)
  // 此时会检测文件是否存在，如果存在则触发秒传
})

uploader.on('QueueDrained', () => {
  // 所有分片上传完成（包括秒传情况）
  console.log('上传完成')
})

await uploader.upload(file)
```

## 秒传的触发条件

秒传仅在以下条件下触发：

1. **文件 Hash 已计算**: 文件完整 Hash 计算完成
2. **服务器端文件存在**: 服务器端存在相同 Hash 值的文件
3. **后端支持**: 后端实现了 `/file/patchHash` 接口的文件检测功能

## 示例：检测秒传

```typescript
import { FileUploader, type UploaderState } from '@wf-upload/core'

let fileHashComputed = false
let isSecondPass = false

const uploader = new FileUploader({
  config: {
    chunkSize: 2 * 1024 * 1024,
    concurrency: 3,
    baseUrl: 'http://localhost:3000/api/file',
  },
  onProgress: (state: UploaderState) => {
    // 检测是否是秒传
    if (state.fileHash && !fileHashComputed) {
      fileHashComputed = true
      // 如果文件 Hash 已计算，但分片还未全部上传，可能是秒传
      if (state.progress.chunksUploaded < state.progress.totalChunks) {
        // 等待检测结果
      }
    }
    
    // 如果所有分片瞬间完成，且 Hash 已计算，则可能是秒传
    if (
      state.fileHash &&
      state.progress.chunksUploaded === state.progress.totalChunks &&
      state.progress.chunksUploaded === state.progress.chunksHashed
    ) {
      isSecondPass = true
      console.log('🎉 文件秒传成功！')
    }
  },
  onCompleted: (url) => {
    if (isSecondPass) {
      console.log('✅ 秒传完成，文件地址:', url)
    } else {
      console.log('✅ 正常上传完成，文件地址:', url)
    }
  },
})

await uploader.upload(file)
```

## 注意事项

1. **Hash 计算时间**: 文件 Hash 计算需要一定时间，大文件可能需要几秒到几十秒
2. **网络请求**: 秒传检测需要向服务器发送请求，有网络延迟
3. **后端实现**: 秒传功能依赖后端实现，确保后端正确实现了文件 Hash 检测
4. **存储策略**: 后端需要基于文件 Hash 进行去重存储，才能实现秒传

## 性能优势

秒传功能带来的性能优势：

- **零数据传输**: 无需上传任何文件数据，节省带宽
- **瞬间完成**: 检测到文件存在后立即完成，用户体验好
- **节省存储**: 多个用户上传相同文件时，只需存储一份
- **降低服务器压力**: 减少服务器存储和网络处理压力
