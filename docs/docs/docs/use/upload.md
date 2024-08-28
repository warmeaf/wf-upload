# 大文件上传

仅需几行代码即可实现大文件上传：

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

```
