<script setup lang="ts">
import { ref } from 'vue'
import { WfUpload } from '@wf-upload/core'
import { AxiosRequestStrategy } from './utils/request'

let uc: WfUpload | null = null
const file = ref<null | File>(null)
const progress = ref<number>(0)

const handleFileChange = (e: Event) => {
  const target = e.target as HTMLInputElement
  // 获取到 File 对象
  if (target.files && target.files.length > 0) {
    file.value = target.files[0]
    console.log(file.value)
    handleUpload(file.value)
  }
}

const handleUpload = (file: File) => {
  uc = new WfUpload(file, new AxiosRequestStrategy('/file'))
  uc.on('error', (e: any) => {
    console.log(e.message)
  })
  uc.on('progress', (uploadedSize: number, totalSize: number) => {
    console.log(uploadedSize, totalSize)
    progress.value = Math.floor((uploadedSize / totalSize) * 100)
  })
  uc.on('end', (res: any) => {
    console.log('整个文件已经上传', res)
  })
  uc.start()
}
const pause = () => {
  uc && uc.pause()
}
const resume = () => {
  uc && uc.resume()
}
</script>

<template>
  <h3>上传大文件</h3>
  <div>
    <label for="file"
      >进度{{ progress }}%<input
        id="file"
        type="file"
        @change="handleFileChange"
    /></label>
  </div>
  <div>
    <progress max="100" :value="progress" />
  </div>
  <div>
    <button @click="pause">暂停</button>
    <button @click="resume">启动</button>
  </div>

  <h3>下载大文件</h3>
  <div>
    <a
      href="http://127.0.0.1:3000/file/05-%E5%89%8D%E7%AB%AF%E5%AD%A6%E4%B9%A0%E6%96%B9%E5%90%91_0f55b468b99b740d.mp4"
      title="Download file"
      download
    >
      05-前端学习方向_0f55b468b99b740d.mp4</a
    >
  </div>
</template>
