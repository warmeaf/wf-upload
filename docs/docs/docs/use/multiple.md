# 多文件上传

wf-upload 支持同时上传多个文件，每个文件使用独立的 `FileUploader` 实例。

## 基本用法

每个文件需要创建独立的 `FileUploader` 实例：

```typescript
import { FileUploader } from '@wf-upload/core'

const files: File[] = [] // 文件列表
const uploaders: FileUploader[] = [] // 上传器列表

// 为每个文件创建上传器
files.forEach((file) => {
  const uploader = new FileUploader({
    config: {
      chunkSize: 2 * 1024 * 1024,
      concurrency: 3,
      baseUrl: 'http://localhost:3000/api/file',
    },
    onProgress: (state) => {
      console.log(`${file.name} 进度:`, state.progress)
    },
    onCompleted: (url) => {
      console.log(`${file.name} 上传完成:`, url)
    },
    onError: (error) => {
      console.error(`${file.name} 上传失败:`, error)
    },
  })
  
  uploaders.push(uploader)
})

// 并行上传所有文件
await Promise.all(uploaders.map((uploader, index) => uploader.upload(files[index])))
```

## 完整示例

```html
<!DOCTYPE html>
<html>
<head>
  <title>多文件上传示例</title>
</head>
<body>
  <input type="file" id="fileInput" multiple />
  <button id="uploadBtn">开始上传</button>
  <div id="fileList"></div>
</body>
</html>
```

```typescript
import { FileUploader, type UploaderState } from '@wf-upload/core'

const fileInput = document.getElementById('fileInput') as HTMLInputElement
const uploadBtn = document.getElementById('uploadBtn') as HTMLButtonElement
const fileListDiv = document.getElementById('fileList') as HTMLDivElement

interface FileUploadItem {
  file: File
  uploader: FileUploader
  state: UploaderState | null
}

const uploadItems: FileUploadItem[] = []

// 文件选择
fileInput.addEventListener('change', (e) => {
  const files = Array.from((e.target as HTMLInputElement).files || [])
  
  files.forEach((file) => {
    const uploader = new FileUploader({
      config: {
        chunkSize: 2 * 1024 * 1024,
        concurrency: 3,
        baseUrl: 'http://localhost:3000/api/file',
      },
      onProgress: (state) => {
        updateFileProgress(file.name, state)
      },
      onCompleted: (url) => {
        updateFileStatus(file.name, 'completed', url)
      },
      onError: (error) => {
        updateFileStatus(file.name, 'failed', undefined, error.message)
      },
    })
    
    uploadItems.push({
      file,
      uploader,
      state: null,
    })
    
    // 添加到 UI
    addFileToUI(file.name)
  })
})

// 开始上传所有文件
uploadBtn.addEventListener('click', async () => {
  uploadBtn.disabled = true
  
  // 并行上传所有文件
  const uploadPromises = uploadItems.map((item) => item.uploader.upload(item.file))
  
  try {
    await Promise.all(uploadPromises)
    console.log('所有文件上传完成')
  } catch (error) {
    console.error('上传过程中出现错误:', error)
  } finally {
    uploadBtn.disabled = false
  }
})

// 更新文件进度
function updateFileProgress(fileName: string, state: UploaderState) {
  const item = uploadItems.find((item) => item.file.name === fileName)
  if (item) {
    item.state = state
    const progressDiv = document.getElementById(`progress-${fileName}`)
    if (progressDiv) {
      const { chunksUploaded, totalChunks } = state.progress
      const percent = Math.round((chunksUploaded / totalChunks) * 100)
      progressDiv.textContent = `${percent}% (${chunksUploaded}/${totalChunks})`
    }
  }
}

// 更新文件状态
function updateFileStatus(
  fileName: string,
  status: string,
  url?: string,
  error?: string
) {
  const statusDiv = document.getElementById(`status-${fileName}`)
  if (statusDiv) {
    if (status === 'completed') {
      statusDiv.textContent = `✅ 完成: ${url}`
    } else if (status === 'failed') {
      statusDiv.textContent = `❌ 失败: ${error}`
    }
  }
}

// 添加到 UI
function addFileToUI(fileName: string) {
  const fileDiv = document.createElement('div')
  fileDiv.id = `file-${fileName}`
  fileDiv.innerHTML = `
    <h3>${fileName}</h3>
    <div id="progress-${fileName}">等待上传...</div>
    <div id="status-${fileName}"></div>
  `
  fileListDiv.appendChild(fileDiv)
}
```

## React 示例

```tsx
import { useState } from 'react'
import { FileUploader, type UploaderState } from '@wf-upload/core'

interface FileItem {
  file: File
  uploader: FileUploader
  state: UploaderState | null
}

function MultipleFileUpload() {
  const [files, setFiles] = useState<FileItem[]>([])
  
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || [])
    
    const newFiles: FileItem[] = selectedFiles.map((file) => {
      const uploader = new FileUploader({
        config: {
          chunkSize: 2 * 1024 * 1024,
          concurrency: 3,
          baseUrl: 'http://localhost:3000/api/file',
        },
        onProgress: (state) => {
          setFiles((prev) =>
            prev.map((item) =>
              item.file === file ? { ...item, state } : item
            )
          )
        },
        onCompleted: (url) => {
          console.log(`${file.name} 上传完成:`, url)
        },
        onError: (error) => {
          console.error(`${file.name} 上传失败:`, error)
        },
      })
      
      return { file, uploader, state: null }
    })
    
    setFiles((prev) => [...prev, ...newFiles])
  }
  
  const handleUpload = async () => {
    await Promise.all(files.map((item) => item.uploader.upload(item.file)))
  }
  
  return (
    <div>
      <input type="file" multiple onChange={handleFileChange} />
      <button onClick={handleUpload}>开始上传</button>
      <div>
        {files.map((item) => {
          const percent = item.state?.progress
            ? Math.round(
                (item.state.progress.chunksUploaded /
                  item.state.progress.totalChunks) *
                  100
              )
            : 0
          
          return (
            <div key={item.file.name}>
              <h3>{item.file.name}</h3>
              <div>进度: {percent}%</div>
              <div>状态: {item.state?.status || '等待'}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

## 注意事项

1. **独立实例**: 每个文件必须使用独立的 `FileUploader` 实例
2. **并发控制**: 每个上传器都有自己的并发控制，多个文件上传时总体并发数 = 文件数 × 每个文件的并发数
3. **资源管理**: 上传完成后，可以考虑清理上传器实例以释放资源
4. **错误处理**: 某个文件上传失败不会影响其他文件的上传
5. **进度追踪**: 为每个文件单独追踪进度，避免混淆

## 并发控制建议

当同时上传多个文件时，需要注意总体并发数：

```typescript
// 假设有 5 个文件，每个文件并发数为 3
// 总体并发数 = 5 × 3 = 15
// 这可能会对服务器造成较大压力

// 建议：降低每个文件的并发数
const uploader = new FileUploader({
  config: {
    chunkSize: 2 * 1024 * 1024,
    concurrency: 2, // 多文件上传时降低并发数
    baseUrl: 'http://localhost:3000/api/file',
  },
})
```

## 顺序上传

如果需要顺序上传（一个接一个），可以使用循环：

```typescript
for (const item of uploadItems) {
  try {
    await item.uploader.upload(item.file)
  } catch (error) {
    console.error(`${item.file.name} 上传失败:`, error)
    // 继续上传下一个文件
  }
}
```
