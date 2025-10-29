<script setup lang="ts">
import { ref, computed } from 'vue'
import { WfUpload } from '@wf-upload/core'

let uc: WfUpload | null = null
const file = ref<null | File>(null)
const progress = ref<number>(0)
const status = ref<'idle' | 'uploading' | 'paused' | 'completed' | 'failed'>(
  'idle'
)
const errorMsg = ref<string>('')
const uploadedSize = ref<number>(0)
const totalSize = ref<number>(0)
const startTime = ref<number>(0)
const speed = ref<number>(0) // bytes/sec
const remainingTime = ref<number>(0) // sec
const resultUrl = ref<string>('')

const humanSpeed = computed(() => {
  const s = speed.value
  if (s <= 0) return '0 B/s'
  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s']
  let idx = 0
  let val = s
  while (val >= 1024 && idx < units.length - 1) {
    val /= 1024
    idx++
  }
  return `${val.toFixed(2)} ${units[idx]}`
})

const humanSize = (bytes: number) => {
  if (!bytes && bytes !== 0) return '-'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let val = bytes
  let idx = 0
  while (val >= 1024 && idx < units.length - 1) {
    val /= 1024
    idx++
  }
  return `${val.toFixed(2)} ${units[idx]}`
}

const handleFileChange = (e: Event) => {
  const target = e.target as HTMLInputElement
  if (target.files && target.files.length > 0) {
    file.value = target.files[0]
    // 重置状态
    progress.value = 0
    status.value = 'idle'
    errorMsg.value = ''
    uploadedSize.value = 0
    totalSize.value = file.value.size
    speed.value = 0
    remainingTime.value = 0
    resultUrl.value = ''
    handleUpload(file.value)
  }
}

const handleUpload = (f: File) => {
  // 如果已有上传实例，优先暂停以避免并发冲突
  if (uc) {
    try {
      uc.pause()
    } catch {}
    uc = null
  }

  uc = new WfUpload(f)
  status.value = 'uploading'
  startTime.value = Date.now()

  uc.on('error', (e: any) => {
    errorMsg.value = e?.message || '上传失败'
    status.value = 'failed'
  })

  uc.on('progress', (uSize: number, tSize: number) => {
    uploadedSize.value = uSize
    totalSize.value = tSize
    progress.value = Math.floor((uSize / tSize) * 100)
    const elapsedSec = (Date.now() - startTime.value) / 1000
    speed.value = elapsedSec > 0 ? uSize / elapsedSec : 0
    const remainingBytes = Math.max(0, tSize - uSize)
    remainingTime.value = speed.value > 0 ? remainingBytes / speed.value : 0
  })

  uc.on('end', (res: any) => {
    status.value = 'completed'
    // 如果服务端返回了可访问地址，展示给用户
    if (res && res.url) {
      resultUrl.value = res.url
    }
  })

  uc.start()
}

const pause = () => {
  if (uc && status.value === 'uploading') {
    uc.pause()
    status.value = 'paused'
  }
}

const resume = () => {
  if (uc && status.value === 'paused') {
    uc.resume()
    status.value = 'uploading'
    // 重新校准开始时间以避免速度估算过慢
    startTime.value =
      Date.now() - (uploadedSize.value / (speed.value || 1)) * 1000
  }
}
</script>

<template>
  <h3>上传大文件</h3>
  <div style="margin-bottom: 12px">
    <label for="file">
      选择文件
      <input id="file" type="file" @change="handleFileChange" />
    </label>
  </div>

  <div v-if="file" style="margin-bottom: 8px">
    <div>文件名：{{ file!.name }}</div>
    <div>文件大小：{{ humanSize(totalSize) }}</div>
    <div>状态：{{ status }}</div>
    <div v-if="errorMsg" style="color: #d33">错误：{{ errorMsg }}</div>
  </div>

  <div style="margin: 10px 0">
    <progress max="100" :value="progress" style="width: 100%" />
    <div>进度：{{ progress }}%</div>
    <div>
      速度：{{ humanSpeed }}，剩余时间：{{ Math.ceil(remainingTime) }} 秒
    </div>
  </div>

  <div>
    <button @click="pause" :disabled="status !== 'uploading'">暂停</button>
    <button @click="resume" :disabled="status !== 'paused'">恢复</button>
  </div>

  <div v-if="resultUrl" style="margin-top: 12px">
    <a :href="resultUrl" target="_blank">上传完成，打开文件</a>
  </div>
</template>
