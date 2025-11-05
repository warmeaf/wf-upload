# 基本使用

`FileUploader` 是 wf-upload 的核心类，用于处理文件上传。

## 创建上传器实例

```typescript
import { FileUploader } from '@wf-upload/core'

const uploader = new FileUploader({
  config: {
    chunkSize: 2 * 1024 * 1024, // 分片大小，默认 2MB
    concurrency: 3, // 并发上传数，默认 3
    baseUrl: 'http://localhost:3000/api/file', // 后端 API 地址
    enableMultiThreading: true, // 是否启用多线程 Hash 计算，默认 true
  },
  onProgress: (state) => {
    // 进度回调
    console.log('上传状态:', state)
  },
  onCompleted: (url) => {
    // 完成回调
    console.log('上传完成，文件地址:', url)
  },
  onError: (error) => {
    // 错误回调
    console.error('上传错误:', error)
  },
})
```

## 上传文件

```typescript
// 获取文件对象（通常来自 input[type="file"]）
const fileInput = document.getElementById('fileInput') as HTMLInputElement
const file = fileInput.files?.[0]

if (file) {
  await uploader.upload(file)
}
```

## 完整示例

```html
<!DOCTYPE html>
<html>
<head>
  <title>文件上传示例</title>
</head>
<body>
  <input type="file" id="fileInput" />
  <button id="uploadBtn">开始上传</button>
  <div id="status"></div>
  <div id="progress"></div>
</body>
</html>
```

```typescript
import { FileUploader } from '@wf-upload/core'

const fileInput = document.getElementById('fileInput') as HTMLInputElement
const uploadBtn = document.getElementById('uploadBtn') as HTMLButtonElement
const statusDiv = document.getElementById('status') as HTMLDivElement
const progressDiv = document.getElementById('progress') as HTMLDivElement

let uploader: FileUploader | null = null

// 创建上传器
function createUploader(file: File) {
  uploader = new FileUploader({
    config: {
      chunkSize: 2 * 1024 * 1024, // 2MB
      concurrency: 3,
      baseUrl: 'http://localhost:3000/api/file',
    },
    onProgress: (state) => {
      statusDiv.textContent = `状态: ${state.status}`
      
      const { chunksUploaded, totalChunks, chunksHashed } = state.progress
      const uploadPercent = Math.round((chunksUploaded / totalChunks) * 100)
      const hashPercent = Math.round((chunksHashed / totalChunks) * 100)
      
      progressDiv.innerHTML = `
        <p>Hash 计算进度: ${hashPercent}% (${chunksHashed}/${totalChunks})</p>
        <p>上传进度: ${uploadPercent}% (${chunksUploaded}/${totalChunks})</p>
      `
    },
    onCompleted: (url) => {
      statusDiv.textContent = '上传完成！'
      alert(`文件上传成功！\n文件地址: ${url}`)
    },
    onError: (error) => {
      statusDiv.textContent = `上传失败: ${error.message}`
      console.error('上传错误:', error)
    },
  })
}

// 文件选择
fileInput.addEventListener('change', (e) => {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (file) {
    createUploader(file)
    statusDiv.textContent = '文件已选择，点击按钮开始上传'
  }
})

// 开始上传
uploadBtn.addEventListener('click', async () => {
  const file = fileInput.files?.[0]
  if (!file) {
    alert('请先选择文件')
    return
  }
  
  if (!uploader) {
    createUploader(file)
  }
  
  try {
    await uploader!.upload(file)
  } catch (error) {
    console.error('上传失败:', error)
  }
})
```

## 获取上传状态

```typescript
const state = uploader.getState()
console.log('当前状态:', state)
// {
//   status: 'uploading',
//   progress: {
//     chunksHashed: 10,
//     chunksUploaded: 8,
//     totalChunks: 20
//   },
//   token: 'xxx',
//   fileHash: 'xxx'
// }
```

## 取消上传

```typescript
uploader.abort()
// 取消后，状态会变为 'failed'，并触发 onError 回调
```

## 注意事项

1. **文件对象**: `upload()` 方法接受标准的 `File` 对象，通常来自 `<input type="file">` 元素
2. **异步操作**: `upload()` 方法是异步的，可以使用 `await` 或 `.then()` 处理
3. **单次使用**: 每个 `FileUploader` 实例设计用于上传单个文件，上传多个文件请创建多个实例
4. **错误处理**: 建议始终提供 `onError` 回调来处理错误情况
