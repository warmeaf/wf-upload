# 架构设计

wf-upload 采用分层架构设计，将代码组织到不同的层次，以提高代码的可维护性、可扩展性和可测试性。

## 分层结构

```
lib/
├── domain/              # 领域层 - 核心业务模型和类型定义
│   └── types.ts         # 所有类型定义、接口和事件类型
│
├── infrastructure/     # 基础设施层 - 技术实现细节
│   ├── api-client.ts   # HTTP API 客户端，处理与服务端的通信
│   └── hash-worker.ts  # Worker 线程实现，负责 Hash 计算
│
├── core/                # 核心业务逻辑层 - 核心算法和数据结构
│   ├── task-queue.ts   # 任务队列，管理分片任务的分配
│   ├── result-buffer.ts # 结果缓冲区，保证事件按顺序触发
│   └── upload-queue.ts # 上传队列，管理并发上传任务
│
├── application/         # 应用服务层 - 协调和编排业务逻辑
│   ├── worker-pool.ts  # Worker 线程池管理
│   └── worker-manager.ts # Worker 管理器，统一管理 Hash 计算
│
└── presentation/        # 表示层 - 对外接口和入口
    ├── file-uploader.ts # 文件上传器主类，协调整个上传流程
    └── index.ts         # 公共 API 导出入口
```

## 分层职责

### Domain Layer (领域层)

**职责**: 定义核心业务模型、类型定义和接口契约

**特点**:
- 不依赖任何其他层
- 包含纯类型定义
- 定义所有接口契约

**文件**: `types.ts`

**内容**:
- 文件信息类型 (`FileInfo`)
- 分片信息类型 (`ChunkInfo`)
- 上传配置类型 (`UploadConfig`)
- 上传状态类型 (`UploaderState`)
- 事件类型定义
- API 请求/响应类型

### Infrastructure Layer (基础设施层)

**职责**: 实现技术细节，如 HTTP 通信、Worker 线程等

**特点**:
- 可以被上层调用
- 不调用业务逻辑层
- 实现具体的技术细节

**文件**:
- `api-client.ts` - HTTP API 客户端
- `hash-worker.ts` - Worker 线程实现

**ApiClient**:
- 负责与后端 API 通信
- 实现创建会话、检测 Hash、上传分片、合并文件等功能
- 使用 Fetch API 进行 HTTP 请求

**HashWorker**:
- 在 Worker 线程中计算文件 Hash
- 使用 SparkMD5 计算 MD5 值
- 支持单线程和多线程模式

### Core Layer (核心业务逻辑层)

**职责**: 实现核心业务算法和数据结构

**特点**:
- 包含核心的业务逻辑
- 可以被应用层调用
- 不依赖具体的技术实现

**文件**:
- `task-queue.ts` - 任务队列
- `result-buffer.ts` - 结果缓冲区
- `upload-queue.ts` - 上传队列

**TaskQueue**:
- 管理分片 Hash 计算任务的分配
- 保证任务按顺序执行或并行执行

**ResultBuffer**:
- 缓冲 Hash 计算结果
- 保证事件按顺序触发
- 处理并发计算的结果

**UploadQueue**:
- 管理分片上传任务
- 控制并发上传数量
- 处理上传失败和重试

### Application Layer (应用服务层)

**职责**: 协调和编排核心业务逻辑，管理 Worker 生命周期

**特点**:
- 组合使用核心层的组件
- 实现复杂的业务流程
- 管理资源生命周期

**文件**:
- `worker-pool.ts` - Worker 线程池
- `worker-manager.ts` - Worker 管理器

**WorkerPool**:
- 管理多个 Worker 线程
- 分配任务到不同的 Worker
- 处理 Worker 的生命周期

**WorkerManager**:
- 统一管理 Hash 计算流程
- 协调 Worker Pool 和任务队列
- 处理事件传递和错误处理

### Presentation Layer (表示层)

**职责**: 提供对外接口，处理用户交互和状态管理

**特点**:
- 最外层，对外暴露统一的 API
- 协调各层组件
- 处理用户交互

**文件**:
- `file-uploader.ts` - 文件上传器主类
- `index.ts` - 公共 API 导出

**FileUploader**:
- 对外提供统一的上传接口
- 协调整个上传流程
- 管理上传状态
- 提供事件系统

## 依赖关系

```
Presentation → Application → Core → Domain
              ↓
         Infrastructure → Domain
```

**依赖规则**:
- 上层可以依赖下层，但下层不能依赖上层
- Domain 层被所有层依赖，但不依赖任何层
- Infrastructure 层只依赖 Domain 层
- Core 层只依赖 Domain 层
- Application 层依赖 Core 层和 Domain 层
- Presentation 层依赖所有下层

## 数据流

### 上传流程

```
用户调用 upload(file)
  ↓
FileUploader.upload()
  ↓
创建会话 (ApiClient.createSession)
  ↓
WorkerManager.startHashing()
  ↓
WorkerPool 分配任务到多个 Worker
  ↓
Worker 计算分片 Hash (HashWorker)
  ↓
ResultBuffer 缓冲结果
  ↓
触发 ChunkHashed 事件
  ↓
UploadQueue 添加上传任务
  ↓
UploadQueue 并发上传分片 (ApiClient.uploadChunk)
  ↓
检测分片是否存在 (ApiClient.checkChunk)
  ↓
如果不存在，实际上传
  ↓
所有分片上传完成
  ↓
合并文件 (ApiClient.mergeFile)
  ↓
触发 onCompleted 回调
```

## 设计优势

### 1. 关注点分离

每层职责明确，便于理解和维护：
- Domain 层：业务模型
- Infrastructure 层：技术实现
- Core 层：核心算法
- Application 层：业务流程
- Presentation 层：用户接口

### 2. 低耦合高内聚

层间依赖清晰，降低模块间耦合：
- 通过接口定义依赖关系
- 每层可以独立测试
- 修改一层不影响其他层

### 3. 易于测试

每层可独立测试，Mock 依赖层：
- Domain 层：纯类型，无需测试
- Infrastructure 层：Mock HTTP 和 Worker
- Core 层：Mock Domain 类型
- Application 层：Mock Core 层
- Presentation 层：Mock 所有下层

### 4. 易于扩展

新增功能时只需修改对应层：
- 新增 API：修改 Infrastructure 层
- 新增算法：修改 Core 层
- 新增功能：修改 Application 层
- 新增接口：修改 Presentation 层

### 5. 代码复用

核心逻辑可在不同场景复用：
- Core 层的队列和缓冲区可以在其他场景复用
- Infrastructure 层的 API 客户端可以独立使用
- Application 层的 Worker 管理可以用于其他计算任务

## 扩展点

### 1. 自定义 API 客户端

可以通过继承或替换 `ApiClient` 来实现自定义的 API 客户端：

```typescript
class CustomApiClient extends ApiClient {
  // 重写方法实现自定义逻辑
}
```

### 2. 自定义 Hash 算法

可以通过修改 `HashWorker` 来支持其他 Hash 算法：

```typescript
// 使用 SHA-256 替代 MD5
```

### 3. 自定义上传策略

可以通过修改 `UploadQueue` 来实现自定义的上传策略：

```typescript
// 实现优先级队列
// 实现上传重试策略
```

## 性能优化

### 1. 多线程 Hash 计算

使用 Worker 线程池并行计算 Hash，充分利用多核 CPU。

### 2. 增量 Hash 计算

无需等待完整文件 Hash 即可开始上传，大幅提升上传速度。

### 3. 并发控制

通过 `UploadQueue` 控制并发上传数量，平衡性能和服务器压力。

### 4. 结果缓冲

使用 `ResultBuffer` 保证事件按顺序触发，避免事件乱序。

## 总结

分层架构设计使得 wf-upload 具有：
- ✅ 清晰的代码结构
- ✅ 易于维护和扩展
- ✅ 良好的可测试性
- ✅ 高性能和可扩展性
