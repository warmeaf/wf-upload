# 大文件上传系统

一个高性能的大文件分片上传解决方案，包含前端上传库和后端服务，支持断点续传、秒传、并发控制等高级功能。

## ✨ 核心特性

### 前端库 (`packages/app`)

- ✅ **分片上传** - 将大文件分割成多个小块进行上传
- ✅ **断点续传** - 自动检测已上传的分片，跳过重复上传
- ✅ **秒传功能** - 通过文件 Hash 值检测文件是否已存在
- ✅ **并发控制** - 可配置的并发上传数量
- ✅ **多线程 Hash 计算** - 使用 Worker 线程池并行计算 Hash，充分利用多核 CPU，避免阻塞主线程
- ✅ **进度追踪** - 实时获取上传进度信息
- ✅ **错误处理** - 完善的错误处理机制
- ✅ **事件系统** - 支持监听各种上传事件
- ✅ **上传取消** - 支持随时取消正在进行的上传任务

### 后端服务 (`server`)

- ✅ **分块上传支持** - 接收和管理文件分块
- ✅ **文件去重** - 基于哈希值的文件去重机制
- ✅ **断点续传** - 支持续传中断的上传任务
- ✅ **数据验证** - 完善的请求数据验证与类型转换
- ✅ **全局异常处理** - 统一的错误处理机制
- ✅ **日志记录** - 详细的操作日志
- ✅ **环境配置管理** - 灵活的配置管理

## 🏗️ 项目结构

```
bigdata-upload/
├── packages/
│   └── app/              # 前端上传库核心代码
│       ├── lib/          # 源代码目录
│       │   ├── domain/           # 领域层 - 核心业务模型和类型定义
│       │   ├── infrastructure/  # 基础设施层 - HTTP通信、Worker线程
│       │   ├── core/            # 核心业务逻辑层 - 核心算法和数据结构
│       │   ├── application/     # 应用服务层 - Worker线程池管理
│       │   └── presentation/    # 表示层 - 对外接口和入口
│       └── docs/        # 前端库文档
├── server/               # 后端服务（NestJS）
│   ├── src/             # 源代码目录
│   │   ├── file/        # 文件上传相关模块
│   │   └── unique-code/ # 唯一码生成服务
│   └── docs/            # 后端API文档
├── examples/             # 示例项目（Vue 3）
└── docs/                 # 项目文档

```

## 🛠️ 技术栈

### 前端库

- **TypeScript** - 类型安全的开发体验
- **Web Workers** - 在 Worker 线程中进行 Hash 计算，避免阻塞主线程
- **SparkMD5** - 用于计算文件分片和完整文件的 MD5 哈希值
- **Fetch API** - 现代化的 HTTP 请求接口
- **EventEmitter 模式** - 事件驱动的架构设计

### 后端服务

- **NestJS** (v10.0.0) - 渐进式 Node.js 框架
- **TypeScript** (v5.1.3) - 类型安全的 JavaScript 超集
- **MongoDB** - NoSQL 文档数据库
- **Mongoose** (v8.5.2) - MongoDB 对象建模工具
- **Express** - HTTP 服务器框架
- **Multer** - 文件上传中间件
- **class-validator** - 数据验证
- **class-transformer** - 对象转换和序列化

## 🚀 快速开始

### 环境要求

- Node.js >= 20.9.0
- pnpm >= 9.9.0
- MongoDB（用于后端数据存储）

### 安装依赖

```bash
# 安装所有依赖（使用 pnpm workspace）
pnpm install
```

### 启动后端服务

```bash
# 开发模式启动后端服务
pnpm server:dev

# 或者进入 server 目录
cd server
pnpm start:dev
```

后端服务默认运行在 `http://localhost:3000`

**注意**：启动前请确保：

1. MongoDB 服务已启动
2. 配置好 MongoDB 连接字符串（在 `server` 目录的环境变量或配置文件中）

### 启动前端示例

```bash
# 启动示例项目
pnpm dev

# 或者进入 examples 目录
cd examples
pnpm dev
```

示例项目默认运行在 `http://localhost:5173`

## 📖 使用文档

### 前端库使用

详细的前端库使用文档请参考：

- [前端库 README](./packages/app/README.md)
- [架构设计文档](./packages/app/docs/Flow.md)
- [Worker 线程池文档](./packages/app/docs/Workers.md)

#### 基本使用示例

```typescript
import { createUploaderWithDefaults } from '@wf-upload/core'

const uploader = createUploaderWithDefaults({
  config: {
    chunkSize: 5 * 1024 * 1024, // 5MB
    concurrency: 3,
    baseUrl: 'http://localhost:3000/api',
  },
  onProgress: (state) => {
    console.log('上传进度:', state.progress)
  },
  onCompleted: (url) => {
    console.log('上传完成:', url)
  },
  onError: (error) => {
    console.error('上传失败:', error)
  },
})

// 上传文件
await uploader.upload(file)
```

### 后端 API 文档

详细的后端 API 文档请参考：

- [后端 README](./server/README.md)
- [API 接口文档](./server/docs/API.md)
- [后端流程文档](./server/docs/Flow.md)

#### API 端点

1. **会话创建** - `POST /file/create`
   - 为新文件初始化上传会话

2. **分块/文件状态检查** - `POST /file/patchHash`
   - 检查特定分块或整个文件是否已存在（用于秒传）

3. **分块上传** - `POST /file/uploadChunk`
   - 上传单个文件分块

4. **文件合并** - `POST /file/merge`
   - 合并所有分块，完成文件上传

## 🏛️ 架构设计

### 前端架构

前端库采用分层架构设计，遵循关注点分离原则：

```
Presentation Layer (表示层)
    ↓
Application Layer (应用服务层)
    ↓
Core Layer (核心业务逻辑层)
    ↓
Domain Layer (领域层)
    ↑
Infrastructure Layer (基础设施层)
```

**分层职责**：

- **Domain Layer**: 定义核心业务模型、类型定义和接口契约
- **Infrastructure Layer**: 实现技术细节，如 HTTP 通信、Worker 线程
- **Core Layer**: 实现核心业务算法和数据结构
- **Application Layer**: 协调和编排核心业务逻辑，管理 Worker 生命周期
- **Presentation Layer**: 提供对外接口，处理用户交互和状态管理

### 后端架构

后端采用 NestJS 模块化架构：

- **Controller**: 处理 HTTP 请求和响应
- **Service**: 实现业务逻辑
- **DTO**: 数据验证和转换
- **Schema**: 数据库模型定义

## 📝 开发脚本

```bash
# 启动后端开发服务器
pnpm server:dev

# 启动前端示例项目
pnpm dev

# 运行测试
pnpm test

# 启动文档服务器
pnpm docs:dev

# 构建文档
pnpm docs:build
```

## 🔧 配置说明

### 前端配置

前端上传库支持以下配置选项：

- `chunkSize`: 分片大小（字节），默认 5MB
- `concurrency`: 并发上传数量，默认 3
- `baseUrl`: 后端 API 基础地址

### 后端配置

后端服务需要配置 MongoDB 连接字符串，可通过环境变量或配置文件设置。

## 📚 更多文档

- [前端库详细文档](./packages/app/README.md)
- [后端服务详细文档](./server/README.md)
- [示例项目](./examples/README.md)
