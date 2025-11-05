# 暂停与恢复

wf-upload 支持暂停和恢复上传功能，允许用户随时暂停上传并在之后恢复。

## 注意

当前版本的 `FileUploader` **不支持暂停和恢复功能**。如果需要暂停上传，可以使用 `abort()` 方法取消上传，然后重新创建上传器实例进行断点续传。

## 使用 abort() 模拟暂停

虽然不支持真正的暂停/恢复，但可以通过以下方式实现类似效果：

```typescript
import { FileUploader } from '@wf-upload/core'

let uploader: FileUploader | null = null
let currentFile: File | null = null

// 开始上传
async function startUpload(file: File) {
  currentFile = file
  uploader = new FileUploader({
    config: {
      chunkSize: 2 * 1024 * 1024,
      concurrency: 3,
      baseUrl: 'http://localhost:3000/api/file',
    },
    onProgress: (state) => {
      console.log('上传进度:', state.progress)
    },
    onCompleted: (url) => {
      console.log('上传完成:', url)
    },
  })
  
  await uploader.upload(file)
}

// "暂停"上传（实际上是取消）
function pauseUpload() {
  if (uploader) {
    uploader.abort()
    uploader = null
    console.log('上传已暂停')
  }
}

// "恢复"上传（实际上是重新开始，会使用断点续传）
async function resumeUpload() {
  if (currentFile) {
    // 重新创建上传器，断点续传会自动处理已上传的分片
    await startUpload(currentFile)
  }
}
```

## 完整示例

```html
<!DOCTYPE html>
<html>
<head>
  <title>暂停上传示例</title>
</head>
<body>
  <input type="file" id="fileInput" />
  <button id="uploadBtn">开始上传</button>
  <button id="pauseBtn" disabled>暂停</button>
  <button id="resumeBtn" disabled>恢复</button>
  <div id="status"></div>
</body>
</html>
```

```typescript
import { FileUploader, type UploaderState } from '@wf-upload/core'

const fileInput = document.getElementById('fileInput') as HTMLInputElement
const uploadBtn = document.getElementById('uploadBtn') as HTMLButtonElement
const pauseBtn = document.getElementById('pauseBtn') as HTMLButtonElement
const resumeBtn = document.getElementById('resumeBtn') as HTMLButtonElement
const statusDiv = document.getElementById('status') as HTMLDivElement

let uploader: FileUploader | null = null
let currentFile: File | null = null
let isPaused = false

// 创建上传器
function createUploader(file: File) {
  return new FileUploader({
    config: {
      chunkSize: 2 * 1024 * 1024,
      concurrency: 3,
      baseUrl: 'http://localhost:3000/api/file',
    },
    onProgress: (state: UploaderState) => {
      const { chunksUploaded, totalChunks } = state.progress
      const percent = Math.round((chunksUploaded / totalChunks) * 100)
      statusDiv.textContent = `上传进度: ${percent}%`
    },
    onCompleted: (url) => {
      statusDiv.textContent = `上传完成: ${url}`
      uploadBtn.disabled = false
      pauseBtn.disabled = true
      resumeBtn.disabled = true
      isPaused = false
    },
    onError: (error) => {
      if (error.message === 'Upload aborted by user') {
        statusDiv.textContent = '上传已暂停'
        isPaused = true
        uploadBtn.disabled = true
        pauseBtn.disabled = true
        resumeBtn.disabled = false
      } else {
        statusDiv.textContent = `上传失败: ${error.message}`
        uploadBtn.disabled = false
        pauseBtn.disabled = true
        resumeBtn.disabled = true
      }
    },
  })
}

// 开始上传
uploadBtn.addEventListener('click', async () => {
  const file = fileInput.files?.[0]
  if (!file) {
    alert('请先选择文件')
    return
  }
  
  currentFile = file
  uploader = createUploader(file)
  
  uploadBtn.disabled = true
  pauseBtn.disabled = false
  resumeBtn.disabled = true
  isPaused = false
  
  try {
    await uploader.upload(file)
  } catch (error) {
    console.error('上传错误:', error)
  }
})

// 暂停上传
pauseBtn.addEventListener('click', () => {
  if (uploader) {
    uploader.abort()
  }
})

// 恢复上传
resumeBtn.addEventListener('click', async () => {
  if (!currentFile) return
  
  uploader = createUploader(currentFile)
  uploadBtn.disabled = true
  pauseBtn.disabled = false
  resumeBtn.disabled = true
  isPaused = false
  
  try {
    await uploader.upload(currentFile)
    // 断点续传会自动处理已上传的分片
  } catch (error) {
    console.error('恢复上传错误:', error)
  }
})
```

## 断点续传的优势

虽然不支持真正的暂停/恢复，但通过 `abort()` + 重新上传的方式，结合断点续传功能，可以实现类似效果：

1. **取消上传**: 调用 `abort()` 取消当前上传
2. **保留进度**: 已上传的分片保留在服务器
3. **重新上传**: 重新创建上传器并上传相同文件
4. **自动续传**: 断点续传机制会自动跳过已上传的分片

## 未来计划

暂停/恢复功能可能在未来的版本中添加。如果你需要这个功能，可以考虑：

1. **提交 Issue**: 在 GitHub 上提交功能请求
2. **贡献代码**: 参与项目开发，实现暂停/恢复功能
3. **使用当前方案**: 使用 `abort()` + 断点续传的方案
