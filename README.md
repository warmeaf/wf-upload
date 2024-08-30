## 大文件上传方案

## 介绍

基于文件分片的大文件上传解决方案。
支持分片上传、文件秒传、暂停上传、断点续传、多文件上传以及文件流式下载。

## 开发

#### 项目结构

```bash
root
├── docs // 文档
├── server // 后端
├── packages // 前端核心实现代码
├── examples // 前端示例
└── README.md
```

#### node 和 pnpm 版本要求

```bash
node: 20.9.0
pnpm: 9.9.0
```

#### 安装依赖

```bash
$ pnpm install
```

#### 启动后端服务
数据库采用 mongodb

```bash
$ pnpm server:dev
```

#### 启动前端服务

```bash
$ pnpm dev
```

#### 单元测试

```bash
$ pnpm test
```
