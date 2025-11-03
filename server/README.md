# 大文件上传后端

## 技术栈

### 核心框架

- **NestJS** (v10.0.0) - 渐进式 Node.js 框架，使用 TypeScript 构建
- **TypeScript** (v5.1.3) - 类型安全的 JavaScript 超集
- **Node.js** - JavaScript 运行时环境

### 数据库

- **MongoDB** - NoSQL 文档数据库
- **Mongoose** (v8.5.2) - MongoDB 对象建模工具
- **@nestjs/mongoose** (v10.0.10) - NestJS 的 MongoDB 集成模块

### Web 框架与中间件

- **Express** - 通过 `@nestjs/platform-express` 提供 HTTP 服务
- **Multer** - 文件上传中间件（通过 NestJS FileInterceptor）

### 配置与验证

- **@nestjs/config** (v3.2.3) - 配置管理模块，支持环境变量
- **class-validator** (v0.14.1) - 基于装饰器的数据验证
- **class-transformer** (v0.5.1) - 对象转换和序列化

### 工具库

- **uuid** (v10.0.0) - 唯一标识符生成
- **jsonwebtoken** (v9.0.2) - JWT 身份验证
- **rxjs** (v7.8.1) - 响应式编程库

### 开发工具

- **@nestjs/cli** - NestJS 命令行工具
- **ESLint** - 代码质量检查
- **Prettier** - 代码格式化
- **Jest** - 单元测试框架
- **ts-jest** - TypeScript 的 Jest 转换器

### 特性

- ✅ 分块上传支持
- ✅ 文件去重（基于哈希值）
- ✅ 断点续传
- ✅ 数据验证与类型转换
- ✅ 全局异常处理
- ✅ 日志记录
- ✅ 环境配置管理
