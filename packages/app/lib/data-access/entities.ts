/**
 * 数据实体定义 - 数据访问层
 * 定义系统中的核心数据模型
 */

import { RetryConfig } from '../infrastructure/RetryService'

export enum ChunkStatus {
  PENDING = 'pending',
  UPLOADING = 'uploading',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled'
}

export enum FileStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  UPLOADING = 'uploading',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled'
}

export enum SessionStatus {
  CREATED = 'created',
  ACTIVE = 'active',
  PAUSED = 'paused',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
  EXPIRED = 'expired'
}

/**
 * 分片实体
 */
export interface ChunkEntity {
  id: string
  sessionId: string
  fileId: string
  index: number
  start: number
  end: number
  size: number
  hash: string
  status: ChunkStatus
  uploadedAt?: number
  retryCount: number
  errorMessage?: string
  createdAt: number
  updatedAt: number
}

/**
 * 文件实体
 */
export interface FileEntity {
  id: string
  sessionId: string
  name: string
  type: string
  size: number
  hash?: string
  status: FileStatus
  uploadedSize: number
  totalChunks: number
  completedChunks: number
  url?: string
  errorMessage?: string
  createdAt: number
  updatedAt: number
}

/**
 * 会话实体
 */
export interface SessionEntity {
  id: string
  fileId: string
  token?: string
  status: SessionStatus
  options: UploadOptions
  progress: ProgressInfo
  errorMessage?: string
  createdAt: number
  updatedAt: number
  expiresAt?: number
}

/**
 * 上传选项
 */
export interface UploadOptions {
  chunkSize?: number
  concurrency?: number
  retryCount?: number
  retryDelay?: number
  timeout?: number
  baseURL?: string
  headers?: Record<string, string>
  enableResume?: boolean
  retryConfig?: Partial<RetryConfig>
  autoCleanup?: boolean
}

/**
 * 进度信息
 */
export interface ProgressInfo {
  uploadedSize: number
  totalSize: number
  uploadedChunks: number
  totalChunks: number
  percentage: number
  speed: number
  remainingTime: number
  startTime: number
  lastUpdateTime: number
}

/**
 * 上传统计信息
 */
export interface UploadStats {
  totalSessions: number
  activeSessions: number
  completedSessions: number
  failedSessions: number
  totalFiles: number
  totalSize: number
  uploadedSize: number
  totalChunks: number
  completedChunks: number
  failedChunks: number
}

/**
 * 查询条件
 */
export interface QueryCondition {
  field: string
  operator: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'nin' | 'like'
  value: any
}

export interface QueryOptions {
  conditions?: QueryCondition[]
  orderBy?: { field: string; direction: 'asc' | 'desc' }[]
  limit?: number
  offset?: number
}

/**
 * 分页结果
 */
export interface PaginatedResult<T> {
  items: T[]
  total: number
  offset: number
  limit: number
  hasMore: boolean
}

/**
 * 实体工厂类
 */
export class EntityFactory {
  static createChunkEntity(
    sessionId: string,
    fileId: string,
    index: number,
    start: number,
    end: number,
    hash: string
  ): ChunkEntity {
    const now = Date.now()
    return {
      id: `chunk_${sessionId}_${index}`,
      sessionId,
      fileId,
      index,
      start,
      end,
      size: end - start,
      hash,
      status: ChunkStatus.PENDING,
      retryCount: 0,
      createdAt: now,
      updatedAt: now
    }
  }

  static createFileEntity(
    sessionId: string,
    name: string,
    type: string,
    size: number,
    totalChunks: number
  ): FileEntity {
    const now = Date.now()
    return {
      id: `file_${sessionId}`,
      sessionId,
      name,
      type,
      size,
      status: FileStatus.PENDING,
      uploadedSize: 0,
      totalChunks,
      completedChunks: 0,
      createdAt: now,
      updatedAt: now
    }
  }

  static createSessionEntity(
    fileId: string,
    options: UploadOptions = {}
  ): SessionEntity {
    const now = Date.now()
    const sessionId = `session_${now}_${Math.random().toString(36).substr(2, 9)}`
    
    return {
      id: sessionId,
      fileId,
      status: SessionStatus.CREATED,
      options: {
        chunkSize: 5 * 1024 * 1024, // 5MB
        concurrency: 3,
        retryCount: 3,
        retryDelay: 1000,
        timeout: 30000,
        enableResume: true,
        autoCleanup: true,
        ...options
      },
      progress: {
        uploadedSize: 0,
        totalSize: 0,
        uploadedChunks: 0,
        totalChunks: 0,
        percentage: 0,
        speed: 0,
        remainingTime: 0,
        startTime: now,
        lastUpdateTime: now
      },
      createdAt: now,
      updatedAt: now,
      expiresAt: now + (24 * 60 * 60 * 1000) // 24小时后过期
    }
  }

  static createProgressInfo(
    uploadedSize: number = 0,
    totalSize: number = 0,
    uploadedChunks: number = 0,
    totalChunks: number = 0
  ): ProgressInfo {
    const now = Date.now()
    const percentage = totalSize > 0 ? (uploadedSize / totalSize) * 100 : 0
    
    return {
      uploadedSize,
      totalSize,
      uploadedChunks,
      totalChunks,
      percentage,
      speed: 0,
      remainingTime: 0,
      startTime: now,
      lastUpdateTime: now
    }
  }
}

/**
 * 实体验证器
 */
export class EntityValidator {
  static validateChunkEntity(chunk: ChunkEntity): string[] {
    const errors: string[] = []
    
    if (!chunk.id) errors.push('Chunk ID is required')
    if (!chunk.sessionId) errors.push('Session ID is required')
    if (!chunk.fileId) errors.push('File ID is required')
    if (chunk.index < 0) errors.push('Chunk index must be non-negative')
    if (chunk.start < 0) errors.push('Chunk start must be non-negative')
    if (chunk.end <= chunk.start) errors.push('Chunk end must be greater than start')
    if (!chunk.hash) errors.push('Chunk hash is required')
    if (chunk.retryCount < 0) errors.push('Retry count must be non-negative')
    
    return errors
  }

  static validateFileEntity(file: FileEntity): string[] {
    const errors: string[] = []
    
    if (!file.id) errors.push('File ID is required')
    if (!file.sessionId) errors.push('Session ID is required')
    if (!file.name) errors.push('File name is required')
    if (!file.type) errors.push('File type is required')
    if (file.size <= 0) errors.push('File size must be positive')
    if (file.uploadedSize < 0) errors.push('Uploaded size must be non-negative')
    if (file.uploadedSize > file.size) errors.push('Uploaded size cannot exceed total size')
    if (file.totalChunks <= 0) errors.push('Total chunks must be positive')
    if (file.completedChunks < 0) errors.push('Completed chunks must be non-negative')
    if (file.completedChunks > file.totalChunks) errors.push('Completed chunks cannot exceed total chunks')
    
    return errors
  }

  static validateSessionEntity(session: SessionEntity): string[] {
    const errors: string[] = []
    
    if (!session.id) errors.push('Session ID is required')
    if (!session.fileId) errors.push('File ID is required')
    if (!session.options) errors.push('Upload options are required')
    if (!session.progress) errors.push('Progress info is required')
    
    if (session.options.chunkSize && session.options.chunkSize <= 0) {
      errors.push('Chunk size must be positive')
    }
    if (session.options.concurrency && session.options.concurrency <= 0) {
      errors.push('Concurrency must be positive')
    }
    if (session.options.retryCount && session.options.retryCount < 0) {
      errors.push('Retry count must be non-negative')
    }
    
    return errors
  }
}