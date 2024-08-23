import type { Chunk, RequestStrategy } from './type'
import { SplitTemplate } from './SplitTemplate'
import { FetchRequestStrategy as DefaultRequestStrategy } from './FetchRequestStrategy'
import { MultiThreadSplitor as DefaultSplit } from './MutilThreadSplitor'
import { Task, TaskQueue, EventEmitter } from '@wf-upload/utils'

export class WfUpload extends EventEmitter<'end' | 'error' | 'progress'> {
  // 任务队列
  private taskQueue: TaskQueue
  // 上传的文件 hash
  private fileHah: string
  // 上传的 token
  private token: string
  // 已经上传的分片大小
  private uploadedSize: number
  // 服务器是否已经存在整个文件
  private isHasFile: Boolean
  // 分片时返回的 emitter
  private emitter: EventEmitter<'chunks'> | null = null

  constructor(
    private file: File,
    private requestStrategy: RequestStrategy = new DefaultRequestStrategy(
      '/file'
    ),
    private splitStrategy: SplitTemplate = new DefaultSplit(
      file,
      1024 * 1024 * 5
    )
  ) {
    super()
    this.fileHah = ''
    this.isHasFile = false
    this.taskQueue = new TaskQueue()
    this.token = ''
    this.uploadedSize = 0
  }

  private async init() {
    const res = await this.requestStrategy.createFile({
      name: this.file.name,
      type: this.file.type,
      size: this.file.size,
      chunksLength: this.splitStrategy.chunksLength,
    })
    if (res.status === 'ok') {
      this.token = res.token
    }
    if (!this.token) {
      throw new Error('文件上传的 token 获取失败！')
    }
    this.splitStrategy.on('chunks', this.handleChunks.bind(this))
    this.splitStrategy.on('wholeHash', this.handleWholeHash.bind(this))
  }

  private handleChunks(chunks: Chunk[]) {
    chunks.forEach((chunk) => {
      this.taskQueue.addAndStart(new Task(this.uploadChunk.bind(this), chunk))
    })
  }

  private async uploadChunk(chunk: Chunk) {
    // console.log('校验分片 hash', new Date().getTime())
    const resp = await this.requestStrategy.patchHash<'chunk'>(
      this.token,
      chunk.hash,
      'chunk'
    )
    if (resp.status !== 'ok') {
      return
    }
    if (resp.hasFile) {
      this.onProgerssHasChunk(chunk)
      return
    }
    // console.log('上传分片', new Date().getTime())
    const res = await this.requestStrategy.uploadChunk({
      ...chunk,
      token: this.token,
    })
    if (res.status === 'ok') {
      this.onProgressNormal(chunk)
    } else {
      console.warn(`分片${chunk.start}到${chunk.end}上传失败！`)
    }
  }

  private async onProgressNormal(chunk: Chunk) {
    this.uploadedSize = this.uploadedSize + (chunk.end - chunk.start)
    if (this.uploadedSize === this.file.size) {
      console.log('分片已经上传完成，开始合并文件')
      // 调用接口合并文件
      if (!this.fileHah) return
      const res = await this.requestStrategy.mergeFile(this.token, this.fileHah)
      if (res.status === 'ok') {
        this.cleanupResources()
        this.emit('end', res)
        this.emit('progress', this.uploadedSize, this.file.size)
      }
    } else {
      this.emit('progress', this.uploadedSize, this.file.size)
    }
  }

  private async onProgerssHasChunk(chunk: Chunk) {
    if (this.isHasFile) return
    if (this.uploadedSize < this.file.size) {
      this.uploadedSize = this.uploadedSize + (chunk.end - chunk.start)
      this.emit('progress', this.uploadedSize, this.file.size)
    } else {
      this.isHasFile = true
    }
  }

  private async handleWholeHash(hash: string) {
    this.fileHah = hash
    const resp = await this.requestStrategy.patchHash<'file'>(
      this.token,
      hash,
      'file'
    )
    if (resp.hasFile) {
      this.cleanupResources()
      this.uploadedSize = this.file.size
      this.emit('end', {})
      this.emit('progress', this.uploadedSize, this.file.size)
    }
  }

  private cleanupResources() {
    // 清空并发任务队列
    this.taskQueue.clear()
    // 销毁分片计算
    this.splitStrategy.dispose()
    // 清空分片数组
    this.splitStrategy.clear()
  }

  pause(): void {
    // 暂停事件分发
    this.splitStrategy.pause()
    // 暂停任务队列
    this.taskQueue.pause()
  }

  resume(): void {
    // 重启事件分发
    this.emitter && this.splitStrategy.resume(this.emitter)
    // 重启任务队列
    this.taskQueue.start()
  }

  async start() {
    try {
      await this.init()
      this.emitter = this.splitStrategy.split()
    } catch (e: any) {
      this.emit('error', e)
    }
  }
}
