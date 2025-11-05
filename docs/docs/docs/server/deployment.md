# 部署指南

本文档介绍如何部署 wf-upload-server 后端服务。

## 环境要求

- Node.js >= 18.0.0
- MongoDB >= 4.4
- npm 或 yarn

## 本地开发

### 1. 安装依赖

```bash
cd server
npm install
```

### 2. 配置环境变量

创建 `.env` 文件：

```env
MONGODB_URI=mongodb://localhost:27017/wf-upload
PORT=3000
NODE_ENV=development
```

### 3. 启动 MongoDB

确保 MongoDB 服务正在运行：

```bash
# macOS (使用 Homebrew)
brew services start mongodb-community

# Linux
sudo systemctl start mongod

# Docker
docker run -d -p 27017:27017 mongo
```

### 4. 启动服务

```bash
# 开发模式（热重载）
npm run start:dev

# 或使用 pnpm
pnpm start:dev
```

服务将在 `http://localhost:3000` 启动。

## 生产部署

### 1. 构建项目

```bash
npm run build
```

构建产物位于 `dist/` 目录。

### 2. 配置生产环境变量

创建 `.env.production` 文件：

```env
MONGODB_URI=mongodb://your-mongodb-host:27017/wf-upload
PORT=3000
NODE_ENV=production
```

### 3. 启动服务

```bash
npm run start:prod
```

## Docker 部署

### 1. 创建 Dockerfile

```dockerfile
FROM node:18-alpine

WORKDIR /app

# 复制 package 文件
COPY package*.json ./

# 安装依赖
RUN npm ci --only=production

# 复制源代码
COPY . .

# 构建项目
RUN npm run build

# 暴露端口
EXPOSE 3000

# 启动服务
CMD ["npm", "run", "start:prod"]
```

### 2. 创建 docker-compose.yml

```yaml
version: '3.8'

services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - MONGODB_URI=mongodb://mongo:27017/wf-upload
      - PORT=3000
      - NODE_ENV=production
    depends_on:
      - mongo

  mongo:
    image: mongo:latest
    ports:
      - "27017:27017"
    volumes:
      - mongo-data:/data/db

volumes:
  mongo-data:
```

### 3. 启动服务

```bash
docker-compose up -d
```

## PM2 部署

### 1. 安装 PM2

```bash
npm install -g pm2
```

### 2. 创建 ecosystem.config.js

```javascript
module.exports = {
  apps: [
    {
      name: 'wf-upload-server',
      script: './dist/main.js',
      instances: 2,
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        MONGODB_URI: 'mongodb://localhost:27017/wf-upload',
      },
      error_file: './logs/err.log',
      out_file: './logs/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },
  ],
}
```

### 3. 启动服务

```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

## 环境变量配置

### 必需变量

- `MONGODB_URI` - MongoDB 连接字符串
- `PORT` - 服务端口（默认: 3000）

### 可选变量

- `NODE_ENV` - 环境模式（development/production）
- `CORS_ORIGIN` - CORS 允许的源（如果需要）

## 性能优化

### 1. 启用集群模式

使用 PM2 或 Node.js 集群模块：

```javascript
// 在 main.ts 中
import cluster from 'cluster'
import os from 'os'

if (cluster.isPrimary) {
  const numWorkers = os.cpus().length
  for (let i = 0; i < numWorkers; i++) {
    cluster.fork()
  }
} else {
  // 启动 NestJS 应用
}
```

### 2. MongoDB 连接池

在 `app.module.ts` 中配置连接池：

```typescript
MongooseModule.forRoot(process.env.MONGODB_URI, {
  maxPoolSize: 10,
  minPoolSize: 2,
})
```

### 3. 启用压缩

安装并配置压缩中间件：

```bash
npm install compression
```

```typescript
// main.ts
import compression from 'compression'

app.use(compression())
```

## 安全配置

### 1. 启用 HTTPS

使用 Nginx 反向代理或配置 SSL：

```nginx
server {
    listen 443 ssl;
    server_name your-domain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### 2. 添加认证

在生产环境中添加认证中间件：

```typescript
// 使用 JWT 或其他认证方案
app.use('/api/file', authenticateMiddleware)
```

### 3. 限制请求大小

```typescript
// main.ts
app.use(json({ limit: '10mb' }))
app.use(urlencoded({ extended: true, limit: '10mb' }))
```

## 监控和日志

### 1. 日志管理

使用 winston 或 pino 进行日志管理：

```bash
npm install winston
```

```typescript
import { WinstonModule } from 'nest-winston'
import winston from 'winston'

const logger = WinstonModule.createLogger({
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' }),
  ],
})
```

### 2. 健康检查

添加健康检查端点：

```typescript
@Get('health')
healthCheck() {
  return {
    status: 'ok',
    timestamp: new Date().toISOString(),
  }
}
```

## 数据库维护

### 1. 定期清理

创建清理脚本，删除未完成的会话和临时分片：

```typescript
// 清理超过 24 小时未完成的会话
async cleanupIncompleteSessions() {
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
  await this.fileModel.deleteMany({
    url: '',
    createdAt: { $lt: oneDayAgo },
  })
}
```

### 2. 备份策略

定期备份 MongoDB 数据：

```bash
mongodump --uri="mongodb://localhost:27017/wf-upload" --out=/backup
```

## 故障排查

### 常见问题

1. **MongoDB 连接失败**
   - 检查 MongoDB 服务是否运行
   - 验证连接字符串是否正确
   - 检查网络连接和防火墙设置

2. **端口被占用**
   - 修改 `PORT` 环境变量
   - 或停止占用端口的进程

3. **内存不足**
   - 增加服务器内存
   - 优化 MongoDB 查询
   - 限制并发请求数

### 日志查看

```bash
# PM2 日志
pm2 logs wf-upload-server

# Docker 日志
docker-compose logs -f app
```

## 更新部署

```bash
# 1. 拉取最新代码
git pull

# 2. 安装依赖
npm install

# 3. 构建项目
npm run build

# 4. 重启服务
pm2 restart wf-upload-server
# 或
docker-compose restart
```
