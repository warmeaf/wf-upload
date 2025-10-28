# @wf-upload/core 全新分层架构设计

## 当前项目结构分析

### 整体项目结构

```
bigdata-upload/
├── packages/                    # 核心包目录
│   ├── app/                    # @wf-upload/core 核心包
│   │   ├── lib/               # 核心实现代码
│   │   │   ├── index.ts       # 主入口文件
│   │   │   ├── request.ts     # WfUpload 主控制器
│   │   │   ├── type.ts        # 类型定义
│   │   │   ├── SplitTemplate.ts        # 分片模板抽象类
│   │   │   ├── MutilThreadSplitor.ts   # 多线程分片实现
│   │   │   ├── SplitWorker.ts          # Worker 线程脚本
│   │   │   ├── FetchRequestStrategy.ts # 默认请求策略
│   │   │   ├── chunk.ts               # 分片工具函数
│   │   │   └── __test__/              # 测试文件
│   │   ├── package.json       # 包配置
│   │   ├── README.md         # 技术文档
│   │   ├── new.md            # 新架构设计文档
│   │   └── tsconfig.json     # TypeScript 配置
│   └── utils/                 # @wf-upload/utils 工具包
│       ├── lib/              # 工具实现
│       │   ├── index.ts      # 工具包入口
│       │   ├── EventEmitter.ts    # 事件发射器
│       │   └── TaskQueue.ts       # 任务队列
│       └── package.json      # 包配置
├── examples/                  # 使用示例
├── docs/                     # 文档站点
├── server/                   # 后端实现 (NestJS)
└── package.json             # 根包配置
```

### 当前核心架构

#### 1. 主要组件关系

```
┌─────────────────────────────────────┐
│           WfUpload                  │  ← 主控制器
│    (文件上传生命周期管理)            │
├─────────────────────────────────────┤
│  RequestStrategy  │  SplitTemplate  │  ← 策略层
│  (请求策略)       │  (分片策略)      │
├─────────────────────────────────────┤
│  TaskQueue       │  EventEmitter    │  ← 基础工具层
│  (任务队列)      │  (事件系统)       │
└─────────────────────────────────────┘
```

#### 2. 核心类职责分析

**WfUpload 类** (`request.ts`)
- **当前职责**：
  - 文件上传流程控制
  - 分片协调和管理
  - 网络请求调度
  - 进度统计和事件发布
  - 状态管理和错误处理
- **问题**：职责过于集中，违反单一职责原则

**SplitTemplate 抽象类** (`SplitTemplate.ts`)
- **当前职责**：
  - 文件分片逻辑
  - Hash 计算协调
  - 分片事件管理
- **实现类**：`MultiThreadSplitor` (多线程分片)

**RequestStrategy 接口** (`type.ts`)
- **当前职责**：
  - 定义网络请求接口规范
  - 文件创建、分片上传、文件合并、Hash校验
- **实现类**：`FetchRequestStrategy` (基于 Fetch API)

**工具层组件**：
- **TaskQueue**：任务队列管理，控制并发上传
- **EventEmitter**：事件发布订阅系统

### 当前架构存在的问题

#### 1. 职责边界不清晰

```typescript
// WfUpload 类承担了过多职责
export class WfUpload extends EventEmitter<'end' | 'error' | 'progress'> {
  private taskQueue: TaskQueue          // 任务调度
  private fileHah: string              // 文件Hash管理
  private token: string                // 认证Token管理
  private uploadedSize: number         // 进度统计
  private isHasFile: Boolean          // 状态管理
  // ... 还有更多职责
}
```

#### 2. 紧耦合问题

```typescript
// 直接依赖具体实现类，而非抽象接口
constructor(
  private file: File,
  private requestStrategy: RequestStrategy = new DefaultRequestStrategy('/file'),
  private splitStrategy: SplitTemplate = new DefaultSplit(file, 1024 * 1024 * 5)
) {
  // 构造函数中硬编码了默认实现
}
```

#### 3. 状态管理分散

```typescript
// 状态分散在不同类中
class WfUpload {
  private uploadedSize: number    // 在主类中
  private isHasFile: Boolean     // 在主类中
}

class SplitTemplate {
  private hasSplited = false     // 在分片类中
  private handleChunkCount = 0   // 在分片类中
}
```

## 当前架构问题分析

### 现有架构的主要问题

1. **职责混乱**：
   - `WfUpload` 类承担了过多职责：文件管理、分片协调、网络请求、进度统计、状态管理等
   - `SplitTemplate` 既负责分片逻辑又负责Hash计算，职责不够单一

2. **紧耦合**：
   - `WfUpload` 直接依赖具体的策略实现类
   - 分片策略与Hash计算策略耦合在一起
   - 网络层与业务逻辑层耦合过紧

3. **扩展性差**：
   - 难以独立替换某个功能模块
   - 新增功能需要修改核心类
   - 测试困难，难以进行单元测试

4. **状态管理混乱**：
   - 状态分散在各个类中
   - 缺乏统一的状态管理机制
   - 错误处理和恢复机制不够完善

## 全新分层架构设计

### 架构原则

1. **单一职责原则**：每个类只负责一个明确的职责
2. **依赖倒置原则**：高层模块不依赖低层模块，都依赖抽象
3. **开闭原则**：对扩展开放，对修改关闭
4. **接口隔离原则**：使用多个专门的接口，而不是单一的总接口
5. **组合优于继承**：通过组合实现功能复用

### 新分层架构

```
┌─────────────────────────────────────────────────────────────┐
│                    应用服务层 (Application Layer)              │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │   UploadService │  │ ProgressService │  │  ErrorService   │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
├─────────────────────────────────────────────────────────────┤
│                    领域服务层 (Domain Layer)                   │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │  FileProcessor  │  │  ChunkManager   │  │  StateManager   │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │  HashCalculator │  │ UploadScheduler │  │ SessionManager  │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
├─────────────────────────────────────────────────────────────┤
│                    基础设施层 (Infrastructure Layer)           │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │ NetworkAdapter  │  │  StorageAdapter │  │  WorkerAdapter  │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │   EventBus      │  │   TaskQueue     │  │   TimerService  │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
├─────────────────────────────────────────────────────────────┤
│                    数据访问层 (Data Access Layer)              │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │ ChunkRepository │  │  FileRepository │  │ SessionRepository│ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

## 各层详细设计

### 1. 应用服务层 (Application Layer)

#### UploadService (上传服务)
```typescript
interface UploadService {
  // 开始上传
  startUpload(file: File, options?: UploadOptions): Promise<UploadSession>
  // 暂停上传
  pauseUpload(sessionId: string): Promise<void>
  // 恢复上传
  resumeUpload(sessionId: string): Promise<void>
  // 取消上传
  cancelUpload(sessionId: string): Promise<void>
  // 获取上传状态
  getUploadStatus(sessionId: string): UploadStatus
}
```

**职责**：
- 提供上传的高级API
- 协调各个领域服务
- 处理用户请求和响应

#### ProgressService (进度服务)
```typescript
interface ProgressService {
  // 订阅进度更新
  subscribe(sessionId: string, callback: ProgressCallback): void
  // 取消订阅
  unsubscribe(sessionId: string, callback: ProgressCallback): void
  // 获取当前进度
  getCurrentProgress(sessionId: string): ProgressInfo
}
```

**职责**：
- 管理进度订阅和通知
- 计算和缓存进度信息
- 提供进度查询接口

#### ErrorService (错误服务)
```typescript
interface ErrorService {
  // 处理错误
  handleError(error: UploadError): ErrorHandlingResult
  // 重试策略
  shouldRetry(error: UploadError, retryCount: number): boolean
  // 错误恢复
  recoverFromError(sessionId: string, error: UploadError): Promise<void>
}
```

**职责**：
- 统一错误处理逻辑
- 实现重试和恢复策略
- 错误分类和上报

### 2. 领域服务层 (Domain Layer)

#### FileProcessor (文件处理器)
```typescript
interface FileProcessor {
  // 验证文件
  validateFile(file: File): ValidationResult
  // 预处理文件
  preprocessFile(file: File): Promise<ProcessedFile>
  // 获取文件元信息
  getFileMetadata(file: File): FileMetadata
}
```

**职责**：
- 文件验证和预处理
- 文件元信息提取
- 文件格式转换

#### ChunkManager (分片管理器)
```typescript
interface ChunkManager {
  // 创建分片
  createChunks(file: File, chunkSize: number): Promise<Chunk[]>
  // 获取分片信息
  getChunkInfo(chunkId: string): ChunkInfo
  // 标记分片完成
  markChunkCompleted(chunkId: string): void
  // 获取待上传分片
  getPendingChunks(sessionId: string): Chunk[]
}
```

**职责**：
- 分片创建和管理
- 分片状态跟踪
- 分片调度优化

#### HashCalculator (哈希计算器)
```typescript
interface HashCalculator {
  // 计算分片哈希
  calculateChunkHash(chunk: Chunk): Promise<string>
  // 计算文件哈希
  calculateFileHash(chunks: Chunk[]): Promise<string>
  // 验证哈希
  verifyHash(data: Blob, expectedHash: string): Promise<boolean>
}
```

**职责**：
- 独立的哈希计算逻辑
- 支持多种哈希算法
- 哈希验证功能

#### UploadScheduler (上传调度器)
```typescript
interface UploadScheduler {
  // 调度上传任务
  scheduleUpload(chunks: Chunk[]): void
  // 设置并发数
  setConcurrency(concurrency: number): void
  // 优先级调度
  setPriority(chunkId: string, priority: number): void
  // 获取调度状态
  getScheduleStatus(): ScheduleStatus
}
```

**职责**：
- 上传任务调度
- 并发控制
- 优先级管理

#### StateManager (状态管理器)
```typescript
interface StateManager {
  // 获取状态
  getState<T>(key: string): T | undefined
  // 设置状态
  setState<T>(key: string, value: T): void
  // 订阅状态变化
  subscribe<T>(key: string, callback: StateChangeCallback<T>): void
  // 持久化状态
  persistState(sessionId: string): Promise<void>
  // 恢复状态
  restoreState(sessionId: string): Promise<void>
}
```

**职责**：
- 集中状态管理
- 状态持久化
- 状态变化通知

#### SessionManager (会话管理器)
```typescript
interface SessionManager {
  // 创建会话
  createSession(file: File, options: UploadOptions): UploadSession
  // 获取会话
  getSession(sessionId: string): UploadSession | undefined
  // 销毁会话
  destroySession(sessionId: string): void
  // 清理过期会话
  cleanupExpiredSessions(): void
}
```

**职责**：
- 上传会话生命周期管理
- 会话数据管理
- 会话清理和回收

### 3. 基础设施层 (Infrastructure Layer)

#### NetworkAdapter (网络适配器)
```typescript
interface NetworkAdapter {
  // 发送请求
  request<T>(config: RequestConfig): Promise<T>
  // 上传分片
  uploadChunk(chunk: UploadChunk): Promise<UploadResult>
  // 批量请求
  batchRequest<T>(configs: RequestConfig[]): Promise<T[]>
  // 请求拦截
  addInterceptor(interceptor: RequestInterceptor): void
}
```

**职责**：
- 网络请求封装
- 请求重试和错误处理
- 请求拦截和转换

#### StorageAdapter (存储适配器)
```typescript
interface StorageAdapter {
  // 存储数据
  store(key: string, data: any): Promise<void>
  // 获取数据
  retrieve<T>(key: string): Promise<T | undefined>
  // 删除数据
  remove(key: string): Promise<void>
  // 清空存储
  clear(): Promise<void>
}
```

**职责**：
- 本地存储抽象
- 支持多种存储方式
- 数据序列化和反序列化

#### WorkerAdapter (Worker适配器)
```typescript
interface WorkerAdapter {
  // 创建Worker
  createWorker(script: string): WorkerInstance
  // 发送消息
  postMessage(workerId: string, message: any): void
  // 监听消息
  onMessage(workerId: string, callback: MessageCallback): void
  // 销毁Worker
  destroyWorker(workerId: string): void
}
```

**职责**：
- Worker线程管理
- 消息通信封装
- 线程池管理

#### EventBus (事件总线)
```typescript
interface EventBus {
  // 发布事件
  emit(event: string, data?: any): void
  // 订阅事件
  on(event: string, callback: EventCallback): void
  // 取消订阅
  off(event: string, callback: EventCallback): void
  // 一次性订阅
  once(event: string, callback: EventCallback): void
}
```

**职责**：
- 解耦组件间通信
- 事件发布订阅
- 事件过滤和转换

#### TaskQueue (任务队列)
```typescript
interface TaskQueue {
  // 添加任务
  addTask(task: Task): void
  // 执行任务
  executeTask(taskId: string): Promise<any>
  // 暂停队列
  pause(): void
  // 恢复队列
  resume(): void
  // 清空队列
  clear(): void
}
```

**职责**：
- 任务队列管理
- 任务执行调度
- 队列状态控制

#### TimerService (定时器服务)
```typescript
interface TimerService {
  // 设置定时器
  setTimeout(callback: Function, delay: number): string
  // 设置间隔器
  setInterval(callback: Function, interval: number): string
  // 清除定时器
  clearTimer(timerId: string): void
  // 暂停所有定时器
  pauseAll(): void
  // 恢复所有定时器
  resumeAll(): void
}
```

**职责**：
- 定时任务管理
- 定时器生命周期控制
- 定时器状态管理

### 4. 数据访问层 (Data Access Layer)

#### ChunkRepository (分片仓库)
```typescript
interface ChunkRepository {
  // 保存分片信息
  saveChunk(chunk: ChunkEntity): Promise<void>
  // 获取分片信息
  getChunk(chunkId: string): Promise<ChunkEntity | undefined>
  // 获取会话的所有分片
  getChunksBySession(sessionId: string): Promise<ChunkEntity[]>
  // 更新分片状态
  updateChunkStatus(chunkId: string, status: ChunkStatus): Promise<void>
  // 删除分片信息
  deleteChunk(chunkId: string): Promise<void>
}
```

**职责**：
- 分片数据持久化
- 分片信息查询
- 分片状态管理

#### FileRepository (文件仓库)
```typescript
interface FileRepository {
  // 保存文件信息
  saveFile(file: FileEntity): Promise<void>
  // 获取文件信息
  getFile(fileId: string): Promise<FileEntity | undefined>
  // 更新文件状态
  updateFileStatus(fileId: string, status: FileStatus): Promise<void>
  // 删除文件信息
  deleteFile(fileId: string): Promise<void>
}
```

**职责**：
- 文件元数据持久化
- 文件信息查询
- 文件状态管理

#### SessionRepository (会话仓库)
```typescript
interface SessionRepository {
  // 保存会话信息
  saveSession(session: SessionEntity): Promise<void>
  // 获取会话信息
  getSession(sessionId: string): Promise<SessionEntity | undefined>
  // 获取所有活跃会话
  getActiveSessions(): Promise<SessionEntity[]>
  // 更新会话状态
  updateSessionStatus(sessionId: string, status: SessionStatus): Promise<void>
  // 删除会话信息
  deleteSession(sessionId: string): Promise<void>
}
```

**职责**：
- 会话数据持久化
- 会话信息查询
- 会话状态管理

## 架构优势

### 1. 高内聚低耦合
- 每层职责明确，内部高度内聚
- 层间通过接口通信，降低耦合度
- 便于独立开发和测试

### 2. 可扩展性强
- 新功能可以通过新增服务实现
- 现有功能可以通过实现接口扩展
- 支持插件化架构

### 3. 可测试性好
- 每个组件职责单一，易于单元测试
- 依赖注入便于Mock测试
- 分层架构便于集成测试

### 4. 可维护性高
- 代码结构清晰，易于理解
- 修改影响范围可控
- 便于代码重构和优化

### 5. 性能优化
- 可以针对不同层进行专门优化
- 支持缓存和预加载策略
- 便于性能监控和分析

## 新旧架构对比

### 架构演进对比

#### 当前架构 vs 新分层架构

| 方面 | 当前架构 | 新分层架构 |
|------|----------|------------|
| **层次结构** | 3层简单架构 | 4层清晰分层 |
| **职责分离** | 职责混乱，WfUpload承担过多职责 | 单一职责，每层职责明确 |
| **依赖关系** | 紧耦合，直接依赖具体实现 | 依赖倒置，面向接口编程 |
| **状态管理** | 状态分散在各个类中 | 集中式状态管理 |
| **扩展性** | 难以扩展，需修改核心类 | 高扩展性，插件化架构 |
| **测试性** | 难以单元测试 | 易于测试，支持Mock |
| **维护性** | 代码耦合度高，维护困难 | 代码清晰，易于维护 |

#### 具体改进点

**1. 职责重新分配**

```typescript
// 当前架构：WfUpload 承担所有职责
class WfUpload {
  // 文件管理 + 分片协调 + 网络请求 + 进度统计 + 状态管理
}

// 新架构：职责分离
class UploadService {      // 只负责上传协调
class ProgressService {    // 只负责进度管理  
class ChunkManager {       // 只负责分片管理
class StateManager {       // 只负责状态管理
class NetworkAdapter {     // 只负责网络请求
```

**2. 依赖关系优化**

```typescript
// 当前架构：直接依赖具体实现
constructor(
  private requestStrategy: RequestStrategy = new DefaultRequestStrategy()
) {}

// 新架构：依赖注入，面向接口
constructor(
  private networkAdapter: NetworkAdapter,
  private stateManager: StateManager,
  private chunkManager: ChunkManager
) {}
```

**3. 状态管理集中化**

```typescript
// 当前架构：状态分散
class WfUpload { private uploadedSize: number }
class SplitTemplate { private hasSplited: boolean }

// 新架构：集中管理
class StateManager {
  getState<T>(key: string): T
  setState<T>(key: string, value: T): void
  subscribe<T>(key: string, callback: StateChangeCallback<T>): void
}
```

### 迁移路径规划

#### 阶段性重构策略

**Phase 1: 基础设施层建设** (1-2周)
- [ ] 实现 EventBus 事件总线
- [ ] 完善 TaskQueue 任务队列
- [ ] 创建 NetworkAdapter 网络适配器
- [ ] 实现 StorageAdapter 存储适配器
- [ ] 建立 Repository 数据访问层

**Phase 2: 领域服务层重构** (2-3周)  
- [ ] 拆分 WfUpload 类职责
- [ ] 实现 FileProcessor 文件处理器
- [ ] 创建 ChunkManager 分片管理器
- [ ] 实现 HashCalculator 哈希计算器
- [ ] 建立 StateManager 状态管理器
- [ ] 创建 SessionManager 会话管理器

**Phase 3: 应用服务层重构** (1-2周)
- [ ] 实现 UploadService 上传服务
- [ ] 创建 ProgressService 进度服务  
- [ ] 实现 ErrorService 错误服务
- [ ] 建立服务间协作关系

**Phase 4: 向后兼容与优化** (1周)
- [ ] 保持原有 API 兼容性
- [ ] 性能优化和监控
- [ ] 完善错误处理
- [ ] 补充测试用例

### 新架构的技术优势

#### 1. 更好的可测试性

```typescript
// 新架构支持依赖注入，便于单元测试
class UploadService {
  constructor(
    private chunkManager: ChunkManager,
    private networkAdapter: NetworkAdapter
  ) {}
}

// 测试时可以轻松Mock依赖
const mockChunkManager = new MockChunkManager()
const mockNetworkAdapter = new MockNetworkAdapter()
const uploadService = new UploadService(mockChunkManager, mockNetworkAdapter)
```

#### 2. 插件化扩展能力

```typescript
// 可以轻松替换不同的实现
const uploadService = new UploadService(
  new S3ChunkManager(),      // 使用S3存储
  new AxiosNetworkAdapter()  // 使用Axios网络库
)
```

#### 3. 更好的错误处理和恢复

```typescript
// 统一的错误处理策略
class ErrorService {
  handleError(error: UploadError): ErrorHandlingResult {
    // 根据错误类型采取不同策略
    switch(error.type) {
      case 'NETWORK_ERROR': return this.handleNetworkError(error)
      case 'CHUNK_ERROR': return this.handleChunkError(error)
      // ...
    }
  }
}
```

## 迁移策略

### 阶段一：基础设施层重构
1. 实现EventBus、TaskQueue等基础组件
2. 创建NetworkAdapter、StorageAdapter等适配器
3. 建立数据访问层接口和实现

### 阶段二：领域服务层重构
1. 拆分现有WfUpload类的职责
2. 实现各个领域服务
3. 建立服务间的协作关系

### 阶段三：应用服务层重构
1. 实现高级API服务
2. 整合各个领域服务
3. 提供向后兼容的接口

### 阶段四：优化和完善
1. 性能优化和监控
2. 错误处理完善
3. 文档和测试补充

## 总结

新的分层架构设计遵循了软件工程的最佳实践，通过清晰的职责分离和合理的依赖关系，构建了一个高度可扩展、可维护、可测试的大文件上传系统。这种架构不仅解决了当前系统的问题，还为未来的功能扩展和性能优化奠定了坚实的基础。