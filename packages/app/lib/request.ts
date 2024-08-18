import type { Chunk, RequestStrategy } from './type'
import { ChunkSplitor } from './ChunkSplitor'
import { DefaultRequestStrategy } from './DefaultRequestStrategy'
import { MultiThreadSplitor } from './MutilThreadSplitor'
import { Task, TaskQueue } from '@wf-upload/utils'
import { EventEmitter } from '@wf-upload/utils'

export class WfUpload extends EventEmitter<'end' | 'error' | 'progress'> {
  private requestStrategy: RequestStrategy // 请求策略
  private splitStrategy: ChunkSplitor // 分片策略
  private taskQueue: TaskQueue // 任务队列
  private file: File // 上传的文件
  private fileHah: string // 上传的文件 hash
  private token: string // 上传的 token
  private chunkSize: number // 上传的分片大小
  private uploadedSize: number // 已经上传的分片
  private isHasFile: Boolean // 服务器是否已经存在整个文件

  constructor(
    file: File,
    requestStrategy?: RequestStrategy,
    splitStrategy?: ChunkSplitor,
    chunkSize?: number
  ) {
    super()
    this.file = file
    this.fileHah = ''
    this.chunkSize = chunkSize || 1024 * 1024 * 5
    this.isHasFile = false
    this.requestStrategy = requestStrategy || new DefaultRequestStrategy()
    this.splitStrategy =
      splitStrategy || new MultiThreadSplitor(this.file, this.chunkSize)
    this.taskQueue = new TaskQueue()
    this.token = ''
    this.uploadedSize = 0
  }

  async init() {
    // console.log(this.file)
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
    const resp = await this.requestStrategy.patchHash(
      this.token,
      chunk.hash,
      'chunk'
    )
    if (resp.hasFile) {
      this.onProgerss(chunk)
      return
    }
    // console.log('上传分片', new Date().getTime())
    const res = await this.requestStrategy.uploadChunk({
      ...chunk,
      token: this.token,
    })
    if (res.status === 'ok') {
      this.onProgerss(chunk)
    } else {
      console.warn(`分片${chunk.start}到${chunk.end}上传失败！`)
    }
  }

  private async onProgerss(chunk: Chunk) {
    if (this.isHasFile) return
    if (this.uploadedSize < this.file.size) {
      this.uploadedSize = this.uploadedSize + (chunk.end - chunk.start)
    } else {
      this.isHasFile = true
    }
    this.emit('progress', this.uploadedSize, this.file.size)

    if (this.uploadedSize === this.file.size) {
      console.log('分片已经上传完成，开始合并文件')
      // 调用接口合并文件
      if (!this.fileHah) return
      const res = await this.requestStrategy.mergeFile(this.token, this.fileHah)
      this.emit('end', res)
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
      // 整个文件之前已经上传，清空并发任务队列
      this.taskQueue.clear()
      console.log('wholeHash', hash)
      this.uploadedSize = this.file.size
      this.emit('end', resp)
    }
  }

  async start() {
    try {
      await this.init()
      this.splitStrategy.split()
    } catch (e: any) {
      this.emit('error', e)
    }
  }
}
