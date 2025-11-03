/**
 * 大文件分片上传系统
 * 主入口文件，导出所有公共API
 */

// ============ 导出主要类 ============

export { FileUploader } from './file-uploader'
export { ApiClient } from './api-client'
export { UploadQueue } from './upload-queue'
export { WorkerManager } from './worker-manager'

// ============ 导出类型定义 ============

export type * from './types'

// ============ 便捷创建函数 ============

import { FileUploader, type FileUploaderOptions } from './file-uploader'

/**
 * 创建文件上传器实例
 */
export function createUploader(options: FileUploaderOptions): FileUploader {
  return new FileUploader(options)
}

/**
 * 默认配置
 */
export const DEFAULT_CONFIG = {
  chunkSize: 2 * 1024 * 1024, // 2MB
  concurrency: 3, // 并发数
  baseUrl: '/api', // API基础路径
  enableMultiThreading: true, // 是否启用多线程
}

/**
 * 创建带默认配置的上传器
 */
export function createUploaderWithDefaults(
  options?: Partial<FileUploaderOptions>
): FileUploader {
  return new FileUploader({
    config: {
      ...DEFAULT_CONFIG,
      ...options?.config,
    },
    ...options,
  })
}
