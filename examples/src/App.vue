<template>
  <div class="upload-container">
    <h1>大文件分片上传系统</h1>
    <p>基于 Vue 3 + TypeScript 的大文件分片上传示例</p>

    <!-- 文件选择区域 -->
    <div class="file-input-section">
      <input
        ref="fileInput"
        type="file"
        @change="handleFileSelect"
        :disabled="state?.status === 'uploading'"
      />
      <button
        v-if="selectedFile && state?.status !== 'uploading'"
        @click="startUpload"
        class="upload-btn"
      >
        开始上传
      </button>
      <button
        v-if="state?.status === 'uploading'"
        @click="abortUpload"
        class="abort-btn"
      >
        取消上传
      </button>
    </div>

    <!-- 文件信息 -->
    <div v-if="selectedFile" class="file-info">
      <h3>文件信息</h3>
      <p><strong>文件名:</strong> {{ selectedFile.name }}</p>
      <p><strong>文件大小:</strong> {{ formatFileSize(selectedFile.size) }}</p>
      <p><strong>文件类型:</strong> {{ selectedFile.type || '未知' }}</p>
    </div>

    <!-- 上传状态 -->
    <div v-if="state" class="status-section">
      <div class="status" :class="state.status">
        状态: {{ getStatusText(state.status) }}
      </div>

      <!-- Hash计算进度 -->
      <div class="progress-section">
        <label>Hash计算进度:</label>
        <div class="progress-bar">
          <div
            class="progress-fill hash-progress"
            :style="{
              width:
                getProgressPercent(
                  state.progress.chunksHashed,
                  state.progress.totalChunks
                ) + '%',
            }"
          ></div>
        </div>
        <span class="progress-text">
          {{ state.progress.chunksHashed }}/{{ state.progress.totalChunks }} ({{
            getProgressPercent(
              state.progress.chunksHashed,
              state.progress.totalChunks
            ).toFixed(1)
          }}%)
        </span>
      </div>

      <!-- 上传进度 -->
      <div class="progress-section">
        <label>上传进度:</label>
        <div class="progress-bar">
          <div
            class="progress-fill upload-progress"
            :style="{
              width:
                getProgressPercent(
                  state.progress.chunksUploaded,
                  state.progress.totalChunks
                ) + '%',
            }"
          ></div>
        </div>
        <span class="progress-text">
          {{ state.progress.chunksUploaded }}/{{
            state.progress.totalChunks
          }}
          ({{
            getProgressPercent(
              state.progress.chunksUploaded,
              state.progress.totalChunks
            ).toFixed(1)
          }}%)
        </span>
      </div>

      <!-- 详细统计 -->
      <div class="stats">
        <div class="stat-item">
          <span class="stat-label">总分片数:</span>
          <span class="stat-value">{{ state.progress.totalChunks }}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">已计算Hash:</span>
          <span class="stat-value">{{ state.progress.chunksHashed }}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">已上传:</span>
          <span class="stat-value">{{ state.progress.chunksUploaded }}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">待上传:</span>
          <span class="stat-value">{{
            Math.max(
              0,
              state.progress.totalChunks - state.progress.chunksHashed
            )
          }}</span>
        </div>
      </div>
    </div>

    <!-- 结果显示 -->
    <div v-if="downloadUrl" class="result success">
      <h3>✅ 上传成功！</h3>
      <p>
        <a :href="downloadUrl" target="_blank" rel="noopener noreferrer">
          点击下载文件
        </a>
      </p>
    </div>

    <div v-if="error" class="result error">
      <h3>❌ 上传失败</h3>
      <p>{{ error }}</p>
      <button @click="resetUpload" class="retry-btn">重新上传</button>
    </div>

    <!-- 配置选项 -->
    <div class="config-section">
      <h3>上传配置</h3>
      <div class="config-item">
        <label>分片大小:</label>
        <select
          v-model="config.chunkSize"
          :disabled="state?.status === 'uploading'"
        >
          <option :value="1024 * 1024">1MB</option>
          <option :value="2 * 1024 * 1024">2MB</option>
          <option :value="5 * 1024 * 1024">5MB</option>
          <option :value="10 * 1024 * 1024">10MB</option>
        </select>
      </div>
      <div class="config-item">
        <label>并发数:</label>
        <select
          v-model="config.concurrency"
          :disabled="state?.status === 'uploading'"
        >
          <option :value="1">1</option>
          <option :value="2">2</option>
          <option :value="3">3</option>
          <option :value="5">5</option>
        </select>
      </div>
      <div class="config-item">
        <label>服务器地址:</label>
        <input
          v-model="config.baseUrl"
          type="text"
          :disabled="state?.status === 'uploading'"
          placeholder="http://localhost:3000/api"
        />
      </div>
    </div>

    <!-- 使用说明 -->
    <div class="instructions">
      <h3>使用说明</h3>
      <ol>
        <li>选择要上传的文件（支持大文件）</li>
        <li>配置分片大小和并发数（可选）</li>
        <li>点击"开始上传"按钮</li>
        <li>系统会自动进行文件分片和Hash计算</li>
        <li>支持断点续传和秒传功能</li>
        <li>上传完成后可以下载文件</li>
      </ol>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue'
import {
  createUploaderWithDefaults,
  type FileInfo,
  type UploaderState,
} from '@wf-upload/core'

// 响应式数据
const fileInput = ref<HTMLInputElement>()
const selectedFile = ref<File | null>(null)
const state = ref<UploaderState | null>(null)
const downloadUrl = ref<string>('')
const error = ref<string>('')
const uploader = ref<any>(null)

// 配置选项
const config = reactive({
  chunkSize: 2 * 1024 * 1024, // 2MB
  concurrency: 3,
  baseUrl: 'http://localhost:3000/api',
})

// 文件选择处理
const handleFileSelect = (event: Event) => {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]

  if (file) {
    selectedFile.value = file
    resetUpload()
  }
}

// 开始上传
const startUpload = async () => {
  if (!selectedFile.value) return

  try {
    // 重置状态
    state.value = null
    downloadUrl.value = ''
    error.value = ''

    // 创建上传器
    uploader.value = createUploaderWithDefaults({
      config: {
        chunkSize: config.chunkSize,
        concurrency: config.concurrency,
        baseUrl: config.baseUrl,
      },
      onProgress: (newState: UploaderState) => {
        state.value = newState
      },
      onCompleted: (url: string) => {
        downloadUrl.value = url
      },
      onError: (err: Error) => {
        error.value = err.message
      },
    })

    const fileInfo: FileInfo = {
      name: selectedFile.value.name,
      size: selectedFile.value.size,
      type: selectedFile.value.type,
      file: selectedFile.value,
    }

    await uploader.value.upload(fileInfo)
  } catch (err) {
    error.value = (err as Error).message
  }
}

// 取消上传
const abortUpload = () => {
  if (uploader.value) {
    uploader.value.abort()
  }
}

// 重置上传状态
const resetUpload = () => {
  state.value = null
  downloadUrl.value = ''
  error.value = ''
  if (uploader.value) {
    uploader.value.abort()
    uploader.value = null
  }
}

// 工具函数
const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 Bytes'

  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

const getProgressPercent = (current: number, total: number): number => {
  return total > 0 ? (current / total) * 100 : 0
}

const getStatusText = (status: string): string => {
  switch (status) {
    case 'idle':
      return '空闲'
    case 'uploading':
      return '上传中...'
    case 'completed':
      return '上传完成'
    case 'failed':
      return '上传失败'
    default:
      return status
  }
}
</script>

<style scoped>
.upload-container {
  max-width: 800px;
  margin: 0 auto;
  padding: 20px;
  font-family:
    -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}

h1 {
  color: #2c3e50;
  text-align: center;
  margin-bottom: 10px;
}

h1 + p {
  text-align: center;
  color: #7f8c8d;
  margin-bottom: 30px;
}

.file-input-section {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 20px;
  padding: 20px;
  border: 2px dashed #bdc3c7;
  border-radius: 8px;
  background-color: #f8f9fa;
}

.file-input-section input[type='file'] {
  flex: 1;
}

button {
  padding: 10px 20px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-weight: 500;
  transition: background-color 0.3s ease;
}

.upload-btn {
  background-color: #3498db;
  color: white;
}

.upload-btn:hover {
  background-color: #2980b9;
}

.abort-btn {
  background-color: #e74c3c;
  color: white;
}

.abort-btn:hover {
  background-color: #c0392b;
}

.retry-btn {
  background-color: #f39c12;
  color: white;
  margin-top: 10px;
}

.retry-btn:hover {
  background-color: #e67e22;
}

.file-info {
  background-color: #ecf0f1;
  padding: 15px;
  border-radius: 8px;
  margin-bottom: 20px;
}

.file-info h3 {
  margin-top: 0;
  color: #2c3e50;
}

.status-section {
  background-color: white;
  border: 1px solid #ddd;
  border-radius: 8px;
  padding: 20px;
  margin-bottom: 20px;
}

.status {
  padding: 10px;
  border-radius: 4px;
  margin-bottom: 20px;
  font-weight: 500;
}

.status.idle {
  background-color: #f8f9fa;
  color: #6c757d;
}

.status.uploading {
  background-color: #e3f2fd;
  color: #1976d2;
}

.status.completed {
  background-color: #e8f5e8;
  color: #2e7d32;
}

.status.failed {
  background-color: #ffebee;
  color: #d32f2f;
}

.progress-section {
  margin-bottom: 15px;
}

.progress-section label {
  display: block;
  margin-bottom: 5px;
  font-weight: 500;
  color: #2c3e50;
}

.progress-bar {
  width: 100%;
  height: 20px;
  background-color: #f0f0f0;
  border-radius: 10px;
  overflow: hidden;
  margin-bottom: 5px;
}

.progress-fill {
  height: 100%;
  transition: width 0.3s ease;
}

.hash-progress {
  background-color: #9c27b0;
}

.upload-progress {
  background-color: #4caf50;
}

.progress-text {
  font-size: 14px;
  color: #666;
}

.stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 10px;
  margin-top: 15px;
}

.stat-item {
  display: flex;
  justify-content: space-between;
  padding: 8px 12px;
  background-color: #f8f9fa;
  border-radius: 4px;
}

.stat-label {
  font-weight: 500;
  color: #495057;
}

.stat-value {
  font-weight: bold;
  color: #2c3e50;
}

.result {
  padding: 20px;
  border-radius: 8px;
  margin-bottom: 20px;
}

.result.success {
  background-color: #d4edda;
  border: 1px solid #c3e6cb;
  color: #155724;
}

.result.error {
  background-color: #f8d7da;
  border: 1px solid #f5c6cb;
  color: #721c24;
}

.result h3 {
  margin-top: 0;
}

.result a {
  color: #007bff;
  text-decoration: none;
  font-weight: 500;
}

.result a:hover {
  text-decoration: underline;
}

.config-section {
  background-color: #f8f9fa;
  padding: 20px;
  border-radius: 8px;
  margin-bottom: 20px;
}

.config-section h3 {
  margin-top: 0;
  color: #2c3e50;
}

.config-item {
  display: flex;
  align-items: center;
  margin-bottom: 10px;
}

.config-item label {
  width: 120px;
  font-weight: 500;
  color: #495057;
}

.config-item select,
.config-item input {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid #ced4da;
  border-radius: 4px;
  font-size: 14px;
}

.config-item select:disabled,
.config-item input:disabled {
  background-color: #e9ecef;
  cursor: not-allowed;
}

.instructions {
  background-color: #e7f3ff;
  padding: 20px;
  border-radius: 8px;
  border-left: 4px solid #007bff;
}

.instructions h3 {
  margin-top: 0;
  color: #2c3e50;
}

.instructions ol {
  margin: 0;
  padding-left: 20px;
}

.instructions li {
  margin-bottom: 5px;
  color: #495057;
}

@media (max-width: 768px) {
  .upload-container {
    padding: 10px;
  }

  .file-input-section {
    flex-direction: column;
    align-items: stretch;
  }

  .stats {
    grid-template-columns: 1fr;
  }

  .config-item {
    flex-direction: column;
    align-items: stretch;
  }

  .config-item label {
    width: auto;
    margin-bottom: 5px;
  }
}
</style>
