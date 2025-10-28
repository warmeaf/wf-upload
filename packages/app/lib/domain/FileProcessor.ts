/**
 * 文件处理器 - 领域服务层
 * 负责文件验证、预处理和元信息提取
 */

export interface ValidationResult {
  isValid: boolean
  errors: string[]
  warnings: string[]
}

export interface FileMetadata {
  name: string
  type: string
  size: number
  lastModified: number
  extension: string
  mimeType: string
  encoding?: string
  checksum?: string
}

export interface ProcessedFile {
  file: File
  metadata: FileMetadata
  chunks: number
  chunkSize: number
  estimatedTime: number
}

export interface FileValidationRule {
  name: string
  validate: (file: File, metadata: FileMetadata) => ValidationResult
}

export interface FileProcessorOptions {
  maxFileSize?: number
  allowedTypes?: string[]
  allowedExtensions?: string[]
  minFileSize?: number
  chunkSize?: number
  enableChecksum?: boolean
  customRules?: FileValidationRule[]
}

export interface FileProcessorInterface {
  // 验证文件
  validateFile(file: File): Promise<ValidationResult>
  // 预处理文件
  preprocessFile(file: File): Promise<ProcessedFile>
  // 获取文件元信息
  getFileMetadata(file: File): Promise<FileMetadata>
  // 添加验证规则
  addValidationRule(rule: FileValidationRule): void
  // 移除验证规则
  removeValidationRule(ruleName: string): void
  // 设置选项
  setOptions(options: Partial<FileProcessorOptions>): void
}

export class FileProcessor implements FileProcessorInterface {
  private options: FileProcessorOptions
  private validationRules: Map<string, FileValidationRule> = new Map()

  constructor(options: FileProcessorOptions = {}) {
    this.options = {
      maxFileSize: 10 * 1024 * 1024 * 1024, // 10GB
      minFileSize: 1, // 1 byte
      chunkSize: 5 * 1024 * 1024, // 5MB
      enableChecksum: false,
      allowedTypes: [], // 空数组表示允许所有类型
      allowedExtensions: [], // 空数组表示允许所有扩展名
      customRules: [],
      ...options
    }

    this.initializeDefaultRules()
    this.initializeCustomRules()
  }

  async validateFile(file: File): Promise<ValidationResult> {
    const metadata = await this.getFileMetadata(file)
    const result: ValidationResult = {
      isValid: true,
      errors: [],
      warnings: []
    }

    // 执行所有验证规则
    for (const rule of this.validationRules.values()) {
      const ruleResult = rule.validate(file, metadata)
      
      result.errors.push(...ruleResult.errors)
      result.warnings.push(...ruleResult.warnings)
      
      if (!ruleResult.isValid) {
        result.isValid = false
      }
    }

    return result
  }

  async preprocessFile(file: File): Promise<ProcessedFile> {
    // 首先验证文件
    const validationResult = await this.validateFile(file)
    if (!validationResult.isValid) {
      throw new Error(`File validation failed: ${validationResult.errors.join(', ')}`)
    }

    const metadata = await this.getFileMetadata(file)
    const chunkSize = this.options.chunkSize!
    const chunks = Math.ceil(file.size / chunkSize)
    
    // 估算上传时间（基于文件大小和网络速度）
    const estimatedSpeed = 1024 * 1024 // 1MB/s 假设网络速度
    const estimatedTime = Math.ceil(file.size / estimatedSpeed)

    return {
      file,
      metadata,
      chunks,
      chunkSize,
      estimatedTime
    }
  }

  async getFileMetadata(file: File): Promise<FileMetadata> {
    const extension = this.extractFileExtension(file.name)
    const mimeType = file.type || this.getMimeTypeByExtension(extension)
    
    const metadata: FileMetadata = {
      name: file.name,
      type: file.type,
      size: file.size,
      lastModified: file.lastModified,
      extension,
      mimeType
    }

    // 如果启用了校验和计算
    if (this.options.enableChecksum) {
      metadata.checksum = await this.calculateFileChecksum(file)
    }

    return metadata
  }

  addValidationRule(rule: FileValidationRule): void {
    this.validationRules.set(rule.name, rule)
  }

  removeValidationRule(ruleName: string): void {
    this.validationRules.delete(ruleName)
  }

  setOptions(options: Partial<FileProcessorOptions>): void {
    this.options = { ...this.options, ...options }
    
    // 重新初始化自定义规则
    if (options.customRules) {
      this.initializeCustomRules()
    }
  }

  // 获取支持的文件类型
  getSupportedTypes(): string[] {
    return this.options.allowedTypes || []
  }

  // 获取支持的文件扩展名
  getSupportedExtensions(): string[] {
    return this.options.allowedExtensions || []
  }

  // 检查文件类型是否支持
  isTypeSupported(type: string): boolean {
    if (!this.options.allowedTypes || this.options.allowedTypes.length === 0) {
      return true // 允许所有类型
    }
    return this.options.allowedTypes.includes(type)
  }

  // 检查文件扩展名是否支持
  isExtensionSupported(extension: string): boolean {
    if (!this.options.allowedExtensions || this.options.allowedExtensions.length === 0) {
      return true // 允许所有扩展名
    }
    return this.options.allowedExtensions.includes(extension.toLowerCase())
  }

  private initializeDefaultRules(): void {
    // 文件大小验证
    this.addValidationRule({
      name: 'fileSize',
      validate: (file: File) => {
        const errors: string[] = []
        const warnings: string[] = []

        if (file.size > this.options.maxFileSize!) {
          errors.push(`File size (${this.formatFileSize(file.size)}) exceeds maximum allowed size (${this.formatFileSize(this.options.maxFileSize!)})`)
        }

        if (file.size < this.options.minFileSize!) {
          errors.push(`File size (${this.formatFileSize(file.size)}) is below minimum required size (${this.formatFileSize(this.options.minFileSize!)})`)
        }

        // 大文件警告
        if (file.size > 100 * 1024 * 1024) { // 100MB
          warnings.push(`Large file detected (${this.formatFileSize(file.size)}). Upload may take a long time.`)
        }

        return {
          isValid: errors.length === 0,
          errors,
          warnings
        }
      }
    })

    // 文件类型验证
    this.addValidationRule({
      name: 'fileType',
      validate: (file: File, metadata: FileMetadata) => {
        const errors: string[] = []
        const warnings: string[] = []

        if (!this.isTypeSupported(file.type)) {
          errors.push(`File type "${file.type}" is not allowed`)
        }

        if (!this.isExtensionSupported(metadata.extension)) {
          errors.push(`File extension "${metadata.extension}" is not allowed`)
        }

        // 类型不匹配警告
        if (file.type && metadata.mimeType && file.type !== metadata.mimeType) {
          warnings.push(`File type mismatch: declared "${file.type}", detected "${metadata.mimeType}"`)
        }

        return {
          isValid: errors.length === 0,
          errors,
          warnings
        }
      }
    })

    // 文件名验证
    this.addValidationRule({
      name: 'fileName',
      validate: (file: File) => {
        const errors: string[] = []
        const warnings: string[] = []

        // 检查文件名长度
        if (file.name.length > 255) {
          errors.push('File name is too long (maximum 255 characters)')
        }

        // 检查非法字符
        const illegalChars = /[<>:"/\\|?*\x00-\x1f]/
        if (illegalChars.test(file.name)) {
          errors.push('File name contains illegal characters')
        }

        // 检查保留名称
        const reservedNames = ['CON', 'PRN', 'AUX', 'NUL', 'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9', 'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9']
        const nameWithoutExt = file.name.split('.')[0].toUpperCase()
        if (reservedNames.includes(nameWithoutExt)) {
          errors.push('File name is reserved and cannot be used')
        }

        return {
          isValid: errors.length === 0,
          errors,
          warnings
        }
      }
    })
  }

  private initializeCustomRules(): void {
    if (this.options.customRules) {
      this.options.customRules.forEach(rule => {
        this.addValidationRule(rule)
      })
    }
  }

  private extractFileExtension(fileName: string): string {
    const lastDotIndex = fileName.lastIndexOf('.')
    return lastDotIndex > 0 ? fileName.substring(lastDotIndex + 1).toLowerCase() : ''
  }

  private getMimeTypeByExtension(extension: string): string {
    const mimeTypes: Record<string, string> = {
      'txt': 'text/plain',
      'pdf': 'application/pdf',
      'doc': 'application/msword',
      'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'xls': 'application/vnd.ms-excel',
      'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'ppt': 'application/vnd.ms-powerpoint',
      'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'png': 'image/png',
      'gif': 'image/gif',
      'bmp': 'image/bmp',
      'svg': 'image/svg+xml',
      'mp4': 'video/mp4',
      'avi': 'video/x-msvideo',
      'mov': 'video/quicktime',
      'mp3': 'audio/mpeg',
      'wav': 'audio/wav',
      'zip': 'application/zip',
      'rar': 'application/x-rar-compressed',
      '7z': 'application/x-7z-compressed',
      'json': 'application/json',
      'xml': 'application/xml',
      'csv': 'text/csv'
    }

    return mimeTypes[extension] || 'application/octet-stream'
  }

  private async calculateFileChecksum(file: File): Promise<string> {
    // 使用 Web Crypto API 计算文件的 SHA-256 校验和
    const buffer = await file.arrayBuffer()
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
  }

  private formatFileSize(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB', 'TB']
    let size = bytes
    let unitIndex = 0

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024
      unitIndex++
    }

    return `${size.toFixed(2)} ${units[unitIndex]}`
  }
}

/**
 * 预定义的验证规则工厂
 */
export class ValidationRuleFactory {
  static createImageOnlyRule(): FileValidationRule {
    return {
      name: 'imageOnly',
      validate: (file: File) => {
        const imageTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/bmp', 'image/webp', 'image/svg+xml']
        const isValid = imageTypes.includes(file.type)
        
        return {
          isValid,
          errors: isValid ? [] : ['Only image files are allowed'],
          warnings: []
        }
      }
    }
  }

  static createVideoOnlyRule(): FileValidationRule {
    return {
      name: 'videoOnly',
      validate: (file: File) => {
        const videoTypes = ['video/mp4', 'video/avi', 'video/mov', 'video/wmv', 'video/flv', 'video/webm']
        const isValid = videoTypes.includes(file.type)
        
        return {
          isValid,
          errors: isValid ? [] : ['Only video files are allowed'],
          warnings: []
        }
      }
    }
  }

  static createDocumentOnlyRule(): FileValidationRule {
    return {
      name: 'documentOnly',
      validate: (file: File) => {
        const documentTypes = [
          'application/pdf',
          'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'application/vnd.ms-excel',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'text/plain'
        ]
        const isValid = documentTypes.includes(file.type)
        
        return {
          isValid,
          errors: isValid ? [] : ['Only document files are allowed'],
          warnings: []
        }
      }
    }
  }

  static createMaxResolutionRule(maxWidth: number, maxHeight: number): FileValidationRule {
    return {
      name: 'maxResolution',
      validate: (file: File) => {
        return new Promise<ValidationResult>((resolve) => {
          if (!file.type.startsWith('image/')) {
            resolve({ isValid: true, errors: [], warnings: [] })
            return
          }

          const img = new Image()
          const url = URL.createObjectURL(file)
          
          img.onload = () => {
            URL.revokeObjectURL(url)
            const isValid = img.width <= maxWidth && img.height <= maxHeight
            resolve({
              isValid,
              errors: isValid ? [] : [`Image resolution (${img.width}x${img.height}) exceeds maximum allowed (${maxWidth}x${maxHeight})`],
              warnings: []
            })
          }
          
          img.onerror = () => {
            URL.revokeObjectURL(url)
            resolve({
              isValid: false,
              errors: ['Unable to read image file'],
              warnings: []
            })
          }
          
          img.src = url
        }) as any
      }
    }
  }
}