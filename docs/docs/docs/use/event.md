# 事件监听

文件上传的过程中，特别是涉及到分片上传时，事件监听是非常重要的，因为它可以帮助你跟踪上传进度、处理错误以及优化用户体验。

## end 事件

文件上传结束：

```TypeScript
import { WfUpload } from '@wf-upload/core'

let uc: WfUpload | null = null
const handleFileChange = (e: Event) => {
  const target = e.target as HTMLInputElement
  // 获取到 File 对象
  if (target.files && target.files.length > 0) {
    uc = new WfUpload(target.files[0])
  }
}

uc.on('end', (res: any) => {
  console.log('文件上传结束', res)
})

```

## error 事件

文件上传出现错误：

```TypeScript
uc.on('error', (e: any) => {
  console.log('文件上传出错', e)
})

```

## progress 事件

文件上传进度监听：

```TypeScript
const progress: number = 0

uc.on('progress', (uploadedSize: number, totalSize: number) => {
  console.log(uploadedSize, totalSize)
  progress = Math.floor((uploadedSize / totalSize) * 100)
})

```
