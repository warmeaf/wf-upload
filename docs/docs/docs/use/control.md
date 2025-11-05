# 上传控制

`FileUploader` 提供了上传控制功能，包括取消上传、获取状态等操作。

## 取消上传

使用 `abort()` 方法可以取消正在进行的上传：

```typescript
import { FileUploader } from '@wf-upload/core'

const uploader = new FileUploader({
  config: { /* ... */ },
  onError: (error) => {
    if (error.message === 'Upload aborted by user') {
      console.log('上传已取消')
    }
  },
})

// 开始上传
await uploader.upload(file)

// 取消上传
uploader.abort()
```

取消上传后：
- 状态会变为 `failed`
- 会触发 `onError` 回调，错误信息为 `"Upload aborted by user"`
- 所有正在进行的上传请求会被中止
- Worker 线程会被终止

## 获取当前状态

使用 `getState()` 方法可以获取当前的上传状态：

```typescript
const state = uploader.getState()
console.log('当前状态:', state)
```

返回的状态对象包含：
- `status` - 上传状态
- `progress` - 进度信息
- `token` - 上传会话 token
- `fileHash` - 文件 Hash（如果已计算）
- `error` - 错误信息（如果有）
- `downloadUrl` - 下载地址（如果已完成）

## 完整示例

```html
<!DOCTYPE html>
<html>
<head>
  <title>上传控制示例</title>
</head>
<body>
  <input type="file" id="fileInput" />
  <button id="uploadBtn">开始上传</button>
  <button id="cancelBtn" disabled>取消上传</button>
  <button id="statusBtn">查看状态</button>
  <div id="status"></div>
  <div id="progress"></div>
</body>
</html>
```

```typescript
import { FileUploader, type UploaderState } from '@wf-upload/core'

const fileInput = document.getElementById('fileInput') as HTMLInputElement
const uploadBtn = document.getElementById('uploadBtn') as HTMLButtonElement
const cancelBtn = document.getElementById('cancelBtn') as HTMLButtonElement
const statusBtn = document.getElementById('statusBtn') as HTMLButtonElement
const statusDiv = document.getElementById('status') as HTMLDivElement
const progressDiv = document.getElementById('progress') as HTMLDivElement

let uploader: FileUploader | null = null

// 创建上传器
function createUploader(file: File) {
  uploader = new FileUploader({
    config: {
      chunkSize: 2 * 1024 * 1024,
      concurrency: 3,
      baseUrl: 'http://localhost:3000/api/file',
    },
    onProgress: (state) => {
      updateProgress(state)
    },
    onCompleted: (url) => {
      statusDiv.textContent = `上传完成！文件地址: ${url}`
      uploadBtn.disabled = false
      cancelBtn.disabled = true
    },
    onError: (error) => {
      if (error.message === 'Upload aborted by user') {
        statusDiv.textContent = '上传已取消'
      } else {
        statusDiv.textContent = `上传失败: ${error.message}`
      }
      uploadBtn.disabled = false
      cancelBtn.disabled = true
    },
  })
}

// 更新进度显示
function updateProgress(state: UploaderState) {
  const { chunksUploaded, totalChunks } = state.progress
  const percent = Math.round((chunksUploaded / totalChunks) * 100)
  progressDiv.textContent = `上传进度: ${percent}% (${chunksUploaded}/${totalChunks})`
}

// 文件选择
fileInput.addEventListener('change', (e) => {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (file) {
    createUploader(file)
  }
})

// 开始上传
uploadBtn.addEventListener('click', async () => {
  const file = fileInput.files?.[0]
  if (!file || !uploader) {
    alert('请先选择文件')
    return
  }
  
  uploadBtn.disabled = true
  cancelBtn.disabled = false
  statusDiv.textContent = '正在上传...'
  
  try {
    await uploader.upload(file)
  } catch (error) {
    console.error('上传错误:', error)
  }
})

// 取消上传
cancelBtn.addEventListener('click', () => {
  if (uploader) {
    uploader.abort()
    uploadBtn.disabled = false
    cancelBtn.disabled = true
  }
})

// 查看状态
statusBtn.addEventListener('click', () => {
  if (uploader) {
    const state = uploader.getState()
    console.log('当前状态:', state)
    alert(JSON.stringify(state, null, 2))
  }
})
```

## React 示例

```tsx
import { useState, useRef } from 'react'
import { FileUploader, type UploaderState } from '@wf-upload/core'

function UploadControl() {
  const [uploader, setUploader] = useState<FileUploader | null>(null)
  const [state, setState] = useState<UploaderState | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    
    const newUploader = new FileUploader({
      config: {
        chunkSize: 2 * 1024 * 1024,
        concurrency: 3,
        baseUrl: 'http://localhost:3000/api/file',
      },
      onProgress: (newState) => {
        setState(newState)
      },
      onCompleted: (url) => {
        alert(`上传完成: ${url}`)
        setIsUploading(false)
      },
      onError: (error) => {
        if (error.message === 'Upload aborted by user') {
          alert('上传已取消')
        } else {
          alert(`上传失败: ${error.message}`)
        }
        setIsUploading(false)
      },
    })
    
    setUploader(newUploader)
  }
  
  const handleUpload = async () => {
    const fileInput = document.getElementById('file') as HTMLInputElement
    const file = fileInput.files?.[0]
    if (!file || !uploader) return
    
    setIsUploading(true)
    await uploader.upload(file)
  }
  
  const handleCancel = () => {
    if (uploader) {
      uploader.abort()
      setIsUploading(false)
    }
  }
  
  const handleStatus = () => {
    if (uploader) {
      const currentState = uploader.getState()
      console.log('当前状态:', currentState)
      alert(JSON.stringify(currentState, null, 2))
    }
  }
  
  return (
    <div>
      <input type="file" id="file" onChange={handleFileChange} />
      <button onClick={handleUpload} disabled={isUploading || !uploader}>
        开始上传
      </button>
      <button onClick={handleCancel} disabled={!isUploading}>
        取消上传
      </button>
      <button onClick={handleStatus} disabled={!uploader}>
        查看状态
      </button>
      {state && (
        <div>
          <p>状态: {state.status}</p>
          <p>
            进度:{' '}
            {Math.round(
              (state.progress.chunksUploaded / state.progress.totalChunks) * 100
            )}
            %
          </p>
        </div>
      )}
    </div>
  )
}
```

## 注意事项

1. **取消操作不可逆**: 一旦调用 `abort()`，当前上传任务将无法恢复
2. **状态查询**: `getState()` 返回的是当前状态的快照，不是实时更新的
3. **错误处理**: 取消上传会触发 `onError` 回调，需要正确处理
4. **资源清理**: 取消上传后，内部资源会自动清理，无需手动处理
