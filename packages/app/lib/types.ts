/**
 * 大文件分片上传系统类型定义
 * 严格遵循文档中的API契约和事件定义
 */

// ============ 基础类型 ============

export interface FileInfo {
  name: string
  size: number
  type: string
}

export interface ChunkInfo {
  index: number
  start: number
  end: number
  size: number
  blob: Blob
  hash?: string
}

// ============ 事件类型 ============

export interface ChunkHashedEvent {
  type: 'ChunkHashed'
  chunk: ChunkInfo & { hash: string }
}

export interface AllChunksHashedEvent {
  type: 'AllChunksHashed'
}

export interface FileHashedEvent {
  type: 'FileHashed'
  fileHash: string
}

export interface QueueDrainedEvent {
  type: 'QueueDrained'
}

export interface QueueAbortedEvent {
  type: 'QueueAborted'
  error: Error
}

export type UploadEvent =
  | ChunkHashedEvent
  | AllChunksHashedEvent
  | FileHashedEvent
  | QueueDrainedEvent
  | QueueAbortedEvent

// ============ 队列状态 ============

export interface QueueStats {
  totalChunks: number
  pending: number
  inFlight: number
  completed: number
  failed: number
  allChunksHashed: boolean
}

export interface QueueTask {
  chunk: ChunkInfo & { hash: string }
  status: 'pending' | 'inFlight' | 'completed' | 'failed'
  error?: Error
}

// ============ API 类型 ============

// POST /file/create
export interface CreateFileRequest {
  fileName: string
  fileSize: number
  fileType: string
  chunksLength: number
}

export interface CreateFileResponse {
  code: 200
  token: string
}

// POST /file/patchHash
export interface PatchHashRequest {
  token: string
  hash: string
  isChunk: boolean
}

export interface PatchHashResponse {
  code: 200
  exists: boolean
}

// POST /file/uploadChunk
export interface UploadChunkRequest {
  token: string
  hash: string
  // blob 通过 FormData 传递
}

export interface UploadChunkResponse {
  code: 200
  success: boolean
}

// POST /file/merge
export interface MergeFileRequest {
  token: string
  fileHash: string
  fileName: string
  chunksLength: number
  chunks: ChunkDto[]
}

export interface ChunkDto {
  index: number
  hash: string
}

export interface MergeFileResponse {
  code: 200
  url: string
}

// ============ 配置类型 ============

export interface UploadConfig {
  chunkSize: number
  concurrency: number
  baseUrl: string
  enableMultiThreading?: boolean // 是否启用多线程Hash计算，默认 true
}

// ============ Worker 消息类型 ============

export interface WorkerStartMessage {
  type: 'start'
  file: File
  chunkSize: number
}

export interface WorkerChunkHashedMessage {
  type: 'chunkHashed'
  chunk: ChunkInfo & { hash: string }
}

export interface WorkerAllChunksHashedMessage {
  type: 'allChunksHashed'
}

export interface WorkerFileHashedMessage {
  type: 'fileHashed'
  fileHash: string
}

export interface WorkerErrorMessage {
  type: 'error'
  error: string
}

// ============ 多线程Worker消息类型 ============

export interface WorkerTaskMessage {
  type: 'task'
  taskId: string // 任务唯一标识
  chunkIndex: number // 分片索引
  blob: Blob // 分片数据
}

export interface WorkerResultMessage {
  type: 'result'
  taskId: string // 任务唯一标识
  chunkIndex: number // 分片索引
  hash: string // 分片Hash
}

export interface WorkerTaskErrorMessage {
  type: 'error'
  taskId?: string // 可选的失败任务ID
  error: string // 错误信息
}

export type WorkerMessage =
  | WorkerChunkHashedMessage
  | WorkerAllChunksHashedMessage
  | WorkerFileHashedMessage
  | WorkerErrorMessage

// ============ 上传器状态 ============

export interface UploaderState {
  status: 'idle' | 'uploading' | 'completed' | 'failed'
  token?: string
  fileHash?: string
  progress: {
    chunksHashed: number
    chunksUploaded: number
    totalChunks: number
  }
  error?: Error
  downloadUrl?: string
}

// ============ 事件监听器类型 ============

export type EventListener<T = any> = (event: T) => void

export interface EventEmitter {
  on<T extends UploadEvent>(
    eventType: T['type'],
    listener: EventListener<T>
  ): void
  off<T extends UploadEvent>(
    eventType: T['type'],
    listener: EventListener<T>
  ): void
  emit<T extends UploadEvent>(event: T): void
}
