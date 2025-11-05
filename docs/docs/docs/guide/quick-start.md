# 快速开始

本指南将帮助你快速集成 wf-upload 到你的项目中。

## 安装

使用你喜欢的包管理器安装：

```bash
# 使用 pnpm
pnpm add @wf-upload/core

# 或使用 npm
npm install @wf-upload/core

# 或使用 yarn
yarn add @wf-upload/core
```

## 基础示例

### HTML

```html
<!DOCTYPE html>
<html>
<head>
  <title>文件上传示例</title>
</head>
<body>
  <input type="file" id="fileInput" />
  <button id="uploadBtn">上传</button>
  <div id="progress"></div>
</body>
</html>
```

### TypeScript / JavaScript

```typescript
import { FileUploader } from '@wf-upload/core'

const fileInput = document.getElementById('fileInput') as HTMLInputElement
const uploadBtn = document.getElementById('uploadBtn') as HTMLButtonElement
const progressDiv = document.getElementById('progress') as HTMLDivElement

let uploader: FileUploader | null = null

// 文件选择
fileInput.addEventListener('change', (e) => {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return

  // 创建上传器实例
  uploader = new FileUploader({
    config: {
      chunkSize: 2 * 1024 * 1024, // 2MB 分片大小
      concurrency: 3, // 并发上传数
      baseUrl: 'http://localhost:3000/api/file', // 后端 API 地址
    },
    onProgress: (state) => {
      // 更新进度显示
      const { chunksUploaded, totalChunks } = state.progress
      const percent = Math.round((chunksUploaded / totalChunks) * 100)
      progressDiv.textContent = `上传进度: ${percent}%`
    },
    onCompleted: (url) => {
      alert(`上传成功！文件地址: ${url}`)
    },
    onError: (error) => {
      alert(`上传失败: ${error.message}`)
    },
  })
})

// 开始上传
uploadBtn.addEventListener('click', async () => {
  const file = fileInput.files?.[0]
  if (!file || !uploader) {
    alert('请先选择文件')
    return
  }

  try {
    await uploader.upload(file)
  } catch (error) {
    console.error('上传错误:', error)
  }
})
```

## React 示例

```tsx
import { useState, useRef } from 'react'
import { FileUploader, type UploaderState } from '@wf-upload/core'

function FileUploadComponent() {
  const [progress, setProgress] = useState<UploaderState | null>(null)
  const uploaderRef = useRef<FileUploader | null>(null)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    uploaderRef.current = new FileUploader({
      config: {
        chunkSize: 2 * 1024 * 1024,
        concurrency: 3,
        baseUrl: 'http://localhost:3000/api/file',
      },
      onProgress: (state) => {
        setProgress(state)
      },
      onCompleted: (url) => {
        alert(`上传成功: ${url}`)
        setProgress(null)
      },
      onError: (error) => {
        alert(`上传失败: ${error.message}`)
        setProgress(null)
      },
    })
  }

  const handleUpload = async () => {
    const fileInput = document.getElementById('file') as HTMLInputElement
    const file = fileInput.files?.[0]
    if (!file || !uploaderRef.current) return

    await uploaderRef.current.upload(file)
  }

  return (
    <div>
      <input type="file" id="file" onChange={handleFileChange} />
      <button onClick={handleUpload}>上传</button>
      {progress && (
        <div>
          <p>状态: {progress.status}</p>
          <p>
            进度:{' '}
            {Math.round(
              (progress.progress.chunksUploaded /
                progress.progress.totalChunks) *
                100
            )}
            %
          </p>
        </div>
      )}
    </div>
  )
}
```

## Vue 示例

```vue
<template>
  <div>
    <input type="file" @change="handleFileChange" />
    <button @click="handleUpload">上传</button>
    <div v-if="progress">
      <p>状态: {{ progress.status }}</p>
      <p>
        进度:
        {{
          Math.round(
            (progress.progress.chunksUploaded /
              progress.progress.totalChunks) *
              100
          )
        }}%
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { FileUploader, type UploaderState } from '@wf-upload/core'

const progress = ref<UploaderState | null>(null)
let uploader: FileUploader | null = null
let selectedFile: File | null = null

const handleFileChange = (e: Event) => {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return

  selectedFile = file
  uploader = new FileUploader({
    config: {
      chunkSize: 2 * 1024 * 1024,
      concurrency: 3,
      baseUrl: 'http://localhost:3000/api/file',
    },
    onProgress: (state) => {
      progress.value = state
    },
    onCompleted: (url) => {
      alert(`上传成功: ${url}`)
      progress.value = null
    },
    onError: (error) => {
      alert(`上传失败: ${error.message}`)
      progress.value = null
    },
  })
}

const handleUpload = async () => {
  if (!selectedFile || !uploader) return
  await uploader.upload(selectedFile)
}
</script>
```

## 下一步

- 查看 [配置选项](/docs/use/config) 了解所有可配置项
- 学习 [事件监听](/docs/use/event) 监听上传事件
- 了解 [高级特性](/docs/use/secondPass) 如秒传、断点续传等
