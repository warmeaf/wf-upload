/**
 * 网络适配器 - 基础设施层
 * 封装网络请求逻辑，提供重试、拦截等功能
 */

export interface RequestConfig {
  url: string
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
  headers?: Record<string, string>
  body?: any
  timeout?: number
  retryCount?: number
  retryDelay?: number
}

export interface UploadChunkConfig extends RequestConfig {
  file: Blob
  token: string
  hash: string
  start: number
  end: number
  index: number
}

export interface UploadResult {
  status: string
  message?: string
  data?: any
}

export interface RequestInterceptor {
  request?: (config: RequestConfig) => RequestConfig | Promise<RequestConfig>
  response?: (response: any) => any | Promise<any>
  error?: (error: Error) => Error | Promise<Error>
}

export interface NetworkAdapterInterface {
  // 发送请求
  request<T>(config: RequestConfig): Promise<T>
  // 上传分片
  uploadChunk(config: UploadChunkConfig): Promise<UploadResult>
  // 批量请求
  batchRequest<T>(configs: RequestConfig[]): Promise<T[]>
  // 请求拦截
  addInterceptor(interceptor: RequestInterceptor): void
  // 移除拦截器
  removeInterceptor(interceptor: RequestInterceptor): void
  // 设置默认配置
  setDefaultConfig(config: Partial<RequestConfig>): void
}

export class NetworkAdapter implements NetworkAdapterInterface {
  private interceptors: RequestInterceptor[] = []
  private defaultConfig: Partial<RequestConfig> = {
    method: 'GET',
    timeout: 30000,
    retryCount: 3,
    retryDelay: 1000,
    headers: {
      'Content-Type': 'application/json'
    }
  }

  async request<T>(config: RequestConfig): Promise<T> {
    const finalConfig = { ...this.defaultConfig, ...config }
    
    // 应用请求拦截器
    let processedConfig = finalConfig
    for (const interceptor of this.interceptors) {
      if (interceptor.request) {
        processedConfig = await interceptor.request(processedConfig)
      }
    }

    return this.executeRequest<T>(processedConfig)
  }

  async uploadChunk(config: UploadChunkConfig): Promise<UploadResult> {
    const formData = new FormData()
    formData.append('token', config.token)
    formData.append('blob', config.file)
    formData.append('hash', config.hash)
    formData.append('start', config.start.toString())
    formData.append('end', config.end.toString())
    formData.append('index', config.index.toString())

    const requestConfig: RequestConfig = {
      ...config,
      method: 'POST',
      body: formData,
      headers: {
        // 不设置 Content-Type，让浏览器自动设置 multipart/form-data
        ...config.headers
      }
    }

    // 移除 Content-Type，让浏览器处理 FormData
    if (requestConfig.headers && requestConfig.headers['Content-Type']) {
      delete requestConfig.headers['Content-Type']
    }

    return this.request<UploadResult>(requestConfig)
  }

  async batchRequest<T>(configs: RequestConfig[]): Promise<T[]> {
    const promises = configs.map(config => this.request<T>(config))
    return Promise.all(promises)
  }

  addInterceptor(interceptor: RequestInterceptor): void {
    this.interceptors.push(interceptor)
  }

  removeInterceptor(interceptor: RequestInterceptor): void {
    const index = this.interceptors.indexOf(interceptor)
    if (index > -1) {
      this.interceptors.splice(index, 1)
    }
  }

  setDefaultConfig(config: Partial<RequestConfig>): void {
    this.defaultConfig = { ...this.defaultConfig, ...config }
  }

  private async executeRequest<T>(config: RequestConfig): Promise<T> {
    const { retryCount = 0, retryDelay = 1000 } = config
    let lastError: Error

    for (let attempt = 0; attempt <= retryCount; attempt++) {
      try {
        const response = await this.performRequest<T>(config)
        
        // 应用响应拦截器
        let processedResponse = response
        for (const interceptor of this.interceptors) {
          if (interceptor.response) {
            processedResponse = await interceptor.response(processedResponse)
          }
        }

        return processedResponse
      } catch (error) {
        lastError = error as Error
        
        // 应用错误拦截器
        for (const interceptor of this.interceptors) {
          if (interceptor.error) {
            lastError = await interceptor.error(lastError)
          }
        }

        // 如果是最后一次尝试，抛出错误
        if (attempt === retryCount) {
          throw lastError
        }

        // 等待重试延迟
        if (retryDelay > 0) {
          await this.delay(retryDelay * Math.pow(2, attempt)) // 指数退避
        }
      }
    }

    throw lastError!
  }

  private async performRequest<T>(config: RequestConfig): Promise<T> {
    const { url, method = 'GET', headers, body, timeout = 30000 } = config

    const normalizedHeaders: Record<string, string> = { ...(headers || {}) }
    if (body instanceof FormData) {
      if (normalizedHeaders['Content-Type']) {
        delete normalizedHeaders['Content-Type']
      }
    } else if (body !== undefined) {
      const ct = normalizedHeaders['Content-Type']
      if (!ct || ct.toLowerCase().includes('multipart/form-data')) {
        normalizedHeaders['Content-Type'] = 'application/json'
      }
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout)

    try {
      const fetchOptions: RequestInit = {
        method,
        headers: normalizedHeaders,
        signal: controller.signal
      }

      // 处理请求体
      if (body !== undefined) {
        if (body instanceof FormData) {
          fetchOptions.body = body
        } else if (typeof body === 'object') {
          fetchOptions.body = JSON.stringify(body)
        } else {
          fetchOptions.body = body
        }
      }

      const response = await fetch(url, fetchOptions)
      
      clearTimeout(timeoutId)

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const text = await response.text()
      if (!text) {
        return {} as T
      }
      try {
        return JSON.parse(text)
      } catch (e) {
        return text as unknown as T
      }
    } catch (error) {
      clearTimeout(timeoutId)
      
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          throw new Error(`Request timeout after ${timeout}ms`)
        }
        throw error
      }
      
      throw new Error('Unknown network error')
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  // 创建请求拦截器的便捷方法
  static createRequestInterceptor(
    requestHandler?: (config: RequestConfig) => RequestConfig | Promise<RequestConfig>
  ): RequestInterceptor {
    return { request: requestHandler }
  }

  static createResponseInterceptor(
    responseHandler?: (response: any) => any | Promise<any>
  ): RequestInterceptor {
    return { response: responseHandler }
  }

  static createErrorInterceptor(
    errorHandler?: (error: Error) => Error | Promise<Error>
  ): RequestInterceptor {
    return { error: errorHandler }
  }
}