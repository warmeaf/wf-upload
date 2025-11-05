# 后端服务概述

wf-upload-server 是基于 NestJS 和 MongoDB 的大文件上传后端服务。

## 技术栈

- **NestJS** (v10.0.0) - 渐进式 Node.js 框架
- **TypeScript** (v5.1.3) - 类型安全的 JavaScript 超集
- **MongoDB** - NoSQL 文档数据库
- **Mongoose** (v8.5.2) - MongoDB 对象建模工具

## 核心功能

- ✅ **分片上传**: 支持大文件分片上传
- ✅ **文件去重**: 基于 Hash 值的文件去重存储
- ✅ **断点续传**: 支持分片级别的断点续传
- ✅ **会话管理**: 使用 token 管理上传会话
- ✅ **数据验证**: 使用 class-validator 进行数据验证
- ✅ **错误处理**: 完善的错误处理机制

## 项目结构

```
server/
├── src/
│   ├── main.ts              # 应用入口
│   ├── app.module.ts        # 根模块
│   ├── app.controller.ts    # 根控制器
│   ├── app.service.ts        # 根服务
│   ├── file/                # 文件模块
│   │   ├── file.controller.ts    # 文件控制器
│   │   ├── file.service.ts       # 文件服务
│   │   ├── file.dto.ts           # 数据传输对象
│   │   ├── file.module.ts        # 文件模块
│   │   └── schema/                # 数据库模型
│   │       ├── file.dto.ts       # 文件模型
│   │       └── fileChunk.dto.ts  # 分片模型
│   ├── unique-code/         # 唯一码服务
│   │   └── unique-code.service.ts
│   └── common/              # 公共模块
│       └── filters/          # 异常过滤器
│           └── http-exception.filter.ts
├── test/                    # 测试文件
├── package.json
└── tsconfig.json
```

## 数据库模型

### FileDocument

文件记录模型。

```typescript
{
  token: string           // 上传会话 token
  fileName: string        // 文件名
  fileType: string        // 文件类型
  fileSize: number        // 文件大小
  chunksLength: number    // 分片数量
  fileHash: string        // 文件 Hash
  chunks: ChunkInfo[]     // 分片信息数组
  url: string             // 文件访问地址
  createdAt: Date         // 创建时间
  updatedAt: Date         // 更新时间
}
```

### FileChunkDocument

分片记录模型。

```typescript
{
  hash: string            // 分片 Hash
  chunk: Buffer           // 分片数据
  createdAt: Date         // 创建时间
}
```

## API 接口

后端提供 4 个核心 API 接口：

1. **POST /file/create** - 创建上传会话
2. **POST /file/patchHash** - 检测分片/文件是否存在
3. **POST /file/uploadChunk** - 上传分片
4. **POST /file/merge** - 合并文件

详见 [API 接口文档](./api.md)。

## 快速开始

### 安装依赖

```bash
cd server
npm install
```

### 配置环境变量

创建 `.env` 文件：

```env
MONGODB_URI=mongodb://localhost:27017/wf-upload
PORT=3000
```

### 启动服务

```bash
# 开发模式
npm run start:dev

# 生产模式
npm run build
npm run start:prod
```

## 配置说明

### MongoDB 连接

在 `app.module.ts` 中配置 MongoDB 连接：

```typescript
MongooseModule.forRoot(process.env.MONGODB_URI || 'mongodb://localhost:27017/wf-upload')
```

### 端口配置

默认端口为 3000，可以通过环境变量 `PORT` 修改。

## 部署

详见 [部署指南](./deployment.md)。

## 与前端集成

前端库会自动调用后端 API，确保：

1. **API 地址**: 前端配置的 `baseUrl` 指向后端服务
2. **CORS**: 后端需要配置 CORS 允许前端域名访问
3. **协议一致**: 确保前后端使用相同的 API 协议

## 特性说明

### 文件去重

后端基于文件 Hash 值进行去重存储：
- 相同 Hash 的文件只存储一份
- 多个上传会话可以共享相同的分片数据
- 实现文件秒传功能

### 分片存储

- 每个分片独立存储，基于 Hash 值去重
- 分片数据存储在 MongoDB 的 `FileChunk` 集合中
- 文件合并时通过分片信息组装完整文件

### 会话管理

- 使用 UUID 生成唯一的 token
- 每个上传会话对应一个 `File` 记录
- Token 用于关联分片和文件

## 注意事项

1. **存储限制**: MongoDB 单个文档大小限制为 16MB，大文件分片需要注意
2. **性能优化**: 可以考虑使用 GridFS 存储大文件
3. **清理策略**: 需要定期清理未完成的会话和临时分片
4. **安全性**: 生产环境需要添加认证和授权机制
