# 大文件上传前端库

一个高性能的大文件分片上传前端库，支持断点续传、秒传、并发控制等功能。

## 技术栈

- **TypeScript** - 类型安全的开发体验
- **Web Workers** - 在 Worker 线程中进行 Hash 计算，避免阻塞主线程
- **SparkMD5** - 用于计算文件分片和完整文件的 MD5 哈希值
- **Fetch API** - 现代化的 HTTP 请求接口
- **EventEmitter 模式** - 事件驱动的架构设计，支持灵活的事件监听

## 核心特性

- ✅ **分片上传** - 将大文件分割成多个小块进行上传
- ✅ **断点续传** - 自动检测已上传的分片，跳过重复上传
- ✅ **秒传功能** - 通过文件 Hash 值检测文件是否已存在
- ✅ **并发控制** - 可配置的并发上传数量
- ✅ **多线程 Hash 计算** - 使用 Worker 线程池并行计算 Hash，充分利用多核 CPU，避免阻塞主线程
- ✅ **进度追踪** - 实时获取上传进度信息
- ✅ **错误处理** - 完善的错误处理机制
- ✅ **事件系统** - 支持监听各种上传事件
- ✅ **上传取消** - 支持随时取消正在进行的上传任务

## 架构设计

本项目采用分层架构思想，将代码组织到不同的层次文件夹中，以提高代码的可维护性、可扩展性和可测试性。

### 分层结构

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

### 分层职责

#### Domain Layer (领域层)
- **职责**: 定义核心业务模型、类型定义和接口契约
- **特点**: 不依赖任何其他层，包含纯类型定义
- **文件**: `types.ts`

#### Infrastructure Layer (基础设施层)
- **职责**: 实现技术细节，如 HTTP 通信、Worker 线程等
- **特点**: 可以被上层调用，但不调用业务逻辑层
- **文件**: `api-client.ts`, `hash-worker.ts`

#### Core Layer (核心业务逻辑层)
- **职责**: 实现核心业务算法和数据结构
- **特点**: 包含核心的业务逻辑，可以被应用层调用
- **文件**: `task-queue.ts`, `result-buffer.ts`, `upload-queue.ts`

#### Application Layer (应用服务层)
- **职责**: 协调和编排核心业务逻辑，管理 Worker 生命周期
- **特点**: 组合使用核心层的组件，实现复杂的业务流程
- **文件**: `worker-pool.ts`, `worker-manager.ts`

#### Presentation Layer (表示层)
- **职责**: 提供对外接口，处理用户交互和状态管理
- **特点**: 最外层，对外暴露统一的 API，协调各层组件
- **文件**: `file-uploader.ts`, `index.ts`

### 依赖关系

```
Presentation → Application → Core → Domain
              ↓
         Infrastructure → Domain
```

- **依赖方向**: 上层可以依赖下层，但下层不能依赖上层
- **Domain 层**: 被所有层依赖，但不依赖任何层
- **Infrastructure 层**: 只依赖 Domain 层
- **Core 层**: 只依赖 Domain 层
- **Application 层**: 依赖 Core 层和 Domain 层
- **Presentation 层**: 依赖所有下层

### 设计优势

1. **关注点分离**: 每层职责明确，便于理解和维护
2. **低耦合高内聚**: 层间依赖清晰，降低模块间耦合
3. **易于测试**: 每层可独立测试，Mock 依赖层
4. **易于扩展**: 新增功能时只需修改对应层，不影响其他层
5. **代码复用**: 核心逻辑可在不同场景复用