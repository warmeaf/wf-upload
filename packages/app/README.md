# @wf-upload/core 技术方案文档

## 概述

@wf-upload/core 是一个高性能的大文件分片上传解决方案，专为处理大文件上传场景而设计。该方案采用分片上传、多线程计算、断点续传等技术，提供了完整的文件上传生命周期管理。

## 核心特性

- **分片上传**：将大文件切分为多个小片段，支持并发上传
- **多线程计算**：利用 Web Worker 进行分片 Hash 计算，避免阻塞主线程
- **断点续传**：支持上传暂停和恢复，已上传分片可跳过
- **秒传功能**：通过文件 Hash 校验实现文件秒传
- **进度监控**：实时上传进度反馈
- **策略模式**：可插拔的请求策略和分片策略

## 架构设计

### 整体架构

系统采用分层架构设计，主要包含以下几个层次：

```
┌─────────────────────────────────────┐
│           用户接口层                 │
│         (WfUpload)                  │
├─────────────────────────────────────┤
│           策略层                     │
│  (RequestStrategy | SplitStrategy)  │
├─────────────────────────────────────┤
│           核心功能层                 │
│    (TaskQueue | EventEmitter)       │
├─────────────────────────────────────┤
│           工具层                     │
│      (Chunk | Hash计算)             │
└─────────────────────────────────────┘
```

### 核心组件

#### 1. WfUpload (主控制器)
- **职责**：文件上传的主要控制器，协调各个组件完成上传流程
- **功能**：
  - 文件上传生命周期管理
  - 事件分发和状态管理
  - 上传进度统计
  - 暂停/恢复控制

#### 2. SplitTemplate (分片策略抽象类)
- **职责**：定义文件分片的标准流程和接口
- **功能**：
  - 文件分片逻辑
  - 分片 Hash 计算协调
  - 整体文件 Hash 计算
  - 事件发布机制

#### 3. MultiThreadSplitor (多线程分片实现)
- **职责**：基于 Web Worker 的多线程分片计算实现
- **功能**：
  - 创建和管理 Worker 线程池
  - 分片任务分发
  - 暂停/恢复机制

#### 4. RequestStrategy (请求策略接口)
- **职责**：定义与服务端交互的标准接口
- **功能**：
  - 文件创建请求
  - 分片上传请求
  - 文件合并请求
  - Hash 校验请求

#### 5. FetchRequestStrategy (HTTP请求实现)
- **职责**：基于 Fetch API 的 HTTP 请求实现
- **功能**：
  - RESTful API 调用
  - 请求参数封装
  - 响应数据处理

## 设计模式

### 1. 策略模式 (Strategy Pattern)
- **应用场景**：请求策略和分片策略的可插拔设计
- **优势**：支持不同的上传策略和分片算法，便于扩展和测试

### 2. 模板方法模式 (Template Method Pattern)
- **应用场景**：SplitTemplate 抽象类定义分片流程模板
- **优势**：统一分片处理流程，子类只需实现具体的计算逻辑

### 3. 观察者模式 (Observer Pattern)
- **应用场景**：EventEmitter 实现事件驱动架构
- **优势**：组件间松耦合，支持异步事件处理

### 4. 工厂模式 (Factory Pattern)
- **应用场景**：Worker 线程的创建和管理
- **优势**：统一线程创建逻辑，便于资源管理

## 技术实现

### 分片机制
- **分片大小**：默认 5MB，可配置
- **分片算法**：基于文件大小和分片大小计算分片数量
- **Hash 算法**：使用 SparkMD5 计算 MD5 哈希值

### 多线程计算
- **线程数量**：基于 `navigator.hardwareConcurrency` 动态确定
- **任务分配**：均匀分配分片计算任务到各个 Worker
- **通信机制**：通过 postMessage 进行主线程与 Worker 通信

### 并发控制
- **任务队列**：使用 TaskQueue 管理上传任务
- **并发限制**：支持配置最大并发数
- **错误重试**：支持失败任务重试机制

### 断点续传
- **状态保存**：通过 Hash 校验确定已上传分片
- **跳过机制**：已存在的分片直接跳过上传
- **进度恢复**：准确计算和恢复上传进度

## 使用流程

### 基本使用
```typescript
import { WfUpload } from '@wf-upload/core'

const uploader = new WfUpload(file)

uploader.on('progress', (uploaded, total) => {
  console.log(`上传进度: ${(uploaded / total * 100).toFixed(2)}%`)
})

uploader.on('end', (result) => {
  console.log('上传完成:', result)
})

uploader.on('error', (error) => {
  console.error('上传失败:', error)
})

await uploader.start()
```

### 自定义策略
```typescript
import { WfUpload, FetchRequestStrategy } from '@wf-upload/core'

const customStrategy = new FetchRequestStrategy('/api/upload')
const uploader = new WfUpload(file, customStrategy)
```

## API 接口规范

### 服务端接口要求

#### 1. 创建文件
- **接口**：`POST /file/create`
- **参数**：`{ name, type, size, chunksLength }`
- **返回**：`{ status: 'ok', token: string }`

#### 2. 上传分片
- **接口**：`POST /file/uploadChunk`
- **参数**：FormData 包含 `token, blob, hash, start, end, index`
- **返回**：`{ status: 'ok' }`

#### 3. 合并文件
- **接口**：`POST /file/merge`
- **参数**：`{ token, hash }`
- **返回**：`{ status: 'ok', url: string }`

#### 4. Hash 校验
- **接口**：`POST /file/patch`
- **参数**：`{ token, hash, type }`
- **返回**：`{ status: 'ok', hasFile: boolean, url?: string }`

## 性能优化

### 1. 内存优化
- 分片处理避免一次性加载整个文件
- Worker 线程隔离计算任务
- 及时清理已处理的分片数据

### 2. 网络优化
- 并发上传控制，避免网络拥塞
- 失败重试机制，提高成功率
- Hash 校验减少重复上传

### 3. 用户体验优化
- 实时进度反馈
- 暂停/恢复功能
- 错误信息提示

## 扩展性

### 自定义请求策略
可以实现 `RequestStrategy` 接口来支持不同的后端 API 或传输协议。

### 自定义分片策略
可以继承 `SplitTemplate` 类来实现不同的分片算法或优化策略。

### 事件扩展
通过 EventEmitter 机制可以轻松添加新的事件类型和处理逻辑。

## 总结

@wf-upload/core 提供了一个完整、高效、可扩展的大文件上传解决方案。通过合理的架构设计和设计模式应用，实现了高性能的文件上传功能，同时保持了良好的可维护性和扩展性。