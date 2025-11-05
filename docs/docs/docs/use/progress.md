# 进度追踪

`FileUploader` 提供了详细的进度追踪功能，可以实时获取上传状态和进度信息。

## 进度回调

最简单的进度追踪方式是使用 `onProgress` 回调：

```typescript
import { FileUploader, type UploaderState } from '@wf-upload/core'

const uploader = new FileUploader({
  config: {
    chunkSize: 2 * 1024 * 1024,
    concurrency: 3,
    baseUrl: 'http://localhost:3000/api/file',
  },
  onProgress: (state: UploaderState) => {
    console.log('上传状态:', state)
  },
})
```

## UploaderState 结构

```typescript
interface UploaderState {
  status: 'idle' | 'uploading' | 'completed' | 'failed'
  token?: string                    // 上传会话 token
  fileHash?: string                 // 文件 Hash 值
  progress: {
    chunksHashed: number            // 已计算 Hash 的分片数
    chunksUploaded: number          // 已上传的分片数
    totalChunks: number             // 总分片数
  }
  error?: Error                     // 错误信息（如果有）
  downloadUrl?: string              // 下载地址（上传完成后）
  chunksHashDuration?: number      // 分片 Hash 计算耗时（毫秒）
}
```

## 状态说明

### status

上传状态，可能的值：

- `idle` - 空闲状态，尚未开始上传
- `uploading` - 正在上传
- `completed` - 上传完成
- `failed` - 上传失败

### progress

进度信息包含三个关键指标：

- `chunksHashed` - 已计算 Hash 的分片数量
- `chunksUploaded` - 已上传的分片数量
- `totalChunks` - 总分片数量

## 计算进度百分比

```typescript
const uploader = new FileUploader({
  config: { /* ... */ },
  onProgress: (state) => {
    const { chunksUploaded, totalChunks, chunksHashed } = state.progress
    
    // Hash 计算进度
    const hashProgress = Math.round((chunksHashed / totalChunks) * 100)
    
    // 上传进度
    const uploadProgress = Math.round((chunksUploaded / totalChunks) * 100)
    
    console.log(`Hash 计算: ${hashProgress}%`)
    console.log(`上传进度: ${uploadProgress}%`)
  },
})
```

## 实时获取状态

除了通过回调获取状态，也可以主动查询：

```typescript
const state = uploader.getState()
console.log('当前状态:', state)
```

## 完整示例

```typescript
import { FileUploader, type UploaderState } from '@wf-upload/core'

const uploader = new FileUploader({
  config: {
    chunkSize: 2 * 1024 * 1024,
    concurrency: 3,
    baseUrl: 'http://localhost:3000/api/file',
  },
  onProgress: (state: UploaderState) => {
    updateUI(state)
  },
})

function updateUI(state: UploaderState) {
  const { status, progress, error, downloadUrl } = state
  
  // 更新状态显示
  document.getElementById('status').textContent = `状态: ${status}`
  
  // 更新进度条
  const { chunksUploaded, totalChunks, chunksHashed } = progress
  const uploadPercent = Math.round((chunksUploaded / totalChunks) * 100)
  const hashPercent = Math.round((chunksHashed / totalChunks) * 100)
  
  document.getElementById('hash-progress').textContent = 
    `Hash 计算: ${hashPercent}% (${chunksHashed}/${totalChunks})`
  document.getElementById('upload-progress').textContent = 
    `上传进度: ${uploadPercent}% (${chunksUploaded}/${totalChunks})`
  
  // 更新进度条样式
  document.getElementById('progress-bar').style.width = `${uploadPercent}%`
  
  // 显示错误
  if (error) {
    document.getElementById('error').textContent = `错误: ${error.message}`
  }
  
  // 显示下载链接
  if (downloadUrl) {
    document.getElementById('download-link').href = downloadUrl
    document.getElementById('download-link').style.display = 'block'
  }
  
  // 显示 Hash 计算耗时
  if (state.chunksHashDuration) {
    console.log(`Hash 计算耗时: ${state.chunksHashDuration}ms`)
  }
}

await uploader.upload(file)
```

## React 示例

```tsx
import { useState } from 'react'
import { FileUploader, type UploaderState } from '@wf-upload/core'

function UploadProgress() {
  const [state, setState] = useState<UploaderState | null>(null)
  
  const uploader = new FileUploader({
    config: {
      chunkSize: 2 * 1024 * 1024,
      concurrency: 3,
      baseUrl: 'http://localhost:3000/api/file',
    },
    onProgress: (newState) => {
      setState(newState)
    },
  })
  
  const { progress, status } = state || {}
  const uploadPercent = progress 
    ? Math.round((progress.chunksUploaded / progress.totalChunks) * 100)
    : 0
  
  return (
    <div>
      <p>状态: {status}</p>
      <div className="progress-bar">
        <div 
          className="progress-fill" 
          style={{ width: `${uploadPercent}%` }}
        />
      </div>
      <p>{uploadPercent}%</p>
      {progress && (
        <p>
          {progress.chunksUploaded} / {progress.totalChunks} 分片已上传
        </p>
      )}
    </div>
  )
}
```

## Vue 示例

```vue
<template>
  <div>
    <p>状态: {{ state?.status }}</p>
    <div class="progress-bar">
      <div 
        class="progress-fill" 
        :style="{ width: `${uploadPercent}%` }"
      />
    </div>
    <p>{{ uploadPercent }}%</p>
    <p v-if="state?.progress">
      {{ state.progress.chunksUploaded }} / {{ state.progress.totalChunks }} 分片已上传
    </p>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { FileUploader, type UploaderState } from '@wf-upload/core'

const state = ref<UploaderState | null>(null)

const uploader = new FileUploader({
  config: {
    chunkSize: 2 * 1024 * 1024,
    concurrency: 3,
    baseUrl: 'http://localhost:3000/api/file',
  },
  onProgress: (newState) => {
    state.value = newState
  },
})

const uploadPercent = computed(() => {
  if (!state.value?.progress) return 0
  const { chunksUploaded, totalChunks } = state.value.progress
  return Math.round((chunksUploaded / totalChunks) * 100)
})
</script>
```
