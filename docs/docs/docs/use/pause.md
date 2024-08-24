# 暂停上传

支持文件上传的暂停和重启：

```HTML
<input id="file" type="file"/>
```

```TypeScript
import { WfUpload } from '@wf-upload/core'

const fileDom: HTMLInputElement | null = document.querySelector('#file')
let uc: WfUpload | null = null

const handleFileChange = (e: Event) => {
  const target = e.target as HTMLInputElement
  // 获取到 File 对象
  if (target.files && target.files.length > 0) {
    uc = new WfUpload(target.files[0])
  }
  uc.start()
}
fileDom?.addEventListener('change', handleFileChange)

// 暂停文件上传
const pause = () => {
  uc && uc.pause()
}
// 重启文件上传
const resume = () => {
  uc && uc.resume()
}

```
