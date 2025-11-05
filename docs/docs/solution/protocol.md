# 通信协议

wf-upload 定义了标准化的前后端通信协议，确保前后端可以无缝协作。

## 协议概述

通信协议基于 HTTP/HTTPS，使用 JSON 格式传输数据（分片上传除外）。所有接口返回统一的响应格式。

## 接口列表

1. **POST /file/create** - 创建上传会话
2. **POST /file/patchHash** - 检测分片/文件是否存在
3. **POST /file/uploadChunk** - 上传分片
4. **POST /file/merge** - 合并文件

## 请求/响应格式

### 统一响应格式

所有接口成功时返回：

```typescript
{
  code: 200
  // 其他字段根据接口不同而不同
}
```

错误时返回：

```typescript
{
  statusCode: number
  message: string
  error?: string
}
```

## 接口详细说明

### 1. 创建上传会话

**请求:**

```http
POST /file/create
Content-Type: application/json

{
  "fileName": "example.pdf",
  "fileType": "application/pdf",
  "fileSize": 10485760,
  "chunksLength": 5
}
```

**响应:**

```json
{
  "code": 200,
  "token": "550e8400-e29b-41d4-a716-446655440000"
}
```

**说明:**
- Token 用于后续所有操作的会话标识
- Token 应该是唯一且不可预测的（建议使用 UUID）

### 2. 检测 Hash

**请求:**

```http
POST /file/patchHash
Content-Type: application/json

{
  "token": "550e8400-e29b-41d4-a716-446655440000",
  "hash": "abc123def456...",
  "isChunk": true
}
```

**响应:**

```json
{
  "code": 200,
  "exists": true
}
```

**说明:**
- `isChunk: true` 表示检测分片 Hash
- `isChunk: false` 表示检测文件 Hash
- 用于实现断点续传和文件秒传

### 3. 上传分片

**请求:**

```http
POST /file/uploadChunk
Content-Type: multipart/form-data

token=550e8400-e29b-41d4-a716-446655440000
hash=abc123def456...
chunk=<binary data>
```

**响应:**

```json
{
  "code": 200,
  "success": true
}
```

**说明:**
- 使用 `multipart/form-data` 格式上传
- `chunk` 字段包含分片的二进制数据
- 如果分片已存在（Hash 相同），可以跳过存储

### 4. 合并文件

**请求:**

```http
POST /file/merge
Content-Type: application/json

{
  "token": "550e8400-e29b-41d4-a716-446655440000",
  "fileHash": "filehash123...",
  "fileName": "example.pdf",
  "chunksLength": 5,
  "chunks": [
    { "index": 0, "hash": "hash0..." },
    { "index": 1, "hash": "hash1..." },
    { "index": 2, "hash": "hash2..." },
    { "index": 3, "hash": "hash3..." },
    { "index": 4, "hash": "hash4..." }
  ]
}
```

**响应:**

```json
{
  "code": 200,
  "url": "example_abc123def456.pdf"
}
```

**说明:**
- `chunks` 数组必须按 `index` 排序
- `chunks.length` 必须等于 `chunksLength`
- `url` 是文件的访问地址

## 完整上传流程

### 正常上传流程

```
1. 创建会话
   POST /file/create
   → 获取 token

2. 计算分片 Hash（前端）
   → 获取每个分片的 Hash 值

3. 检测分片是否存在
   POST /file/patchHash (isChunk: true)
   → 如果不存在，继续下一步；如果存在，跳过上传

4. 上传分片
   POST /file/uploadChunk
   → 上传分片数据

5. 重复步骤 3-4 直到所有分片上传完成

6. 计算文件 Hash（前端）
   → 获取文件完整 Hash 值

7. 检测文件是否存在（秒传）
   POST /file/patchHash (isChunk: false)
   → 如果存在，直接完成；如果不存在，继续下一步

8. 合并文件
   POST /file/merge
   → 合并所有分片，完成上传
```

### 秒传流程

```
1. 创建会话
   POST /file/create
   → 获取 token

2. 计算文件 Hash（前端）
   → 获取文件完整 Hash 值

3. 检测文件是否存在
   POST /file/patchHash (isChunk: false)
   → exists: true

4. 直接完成上传（无需上传分片）
```

### 断点续传流程

```
1. 创建会话
   POST /file/create
   → 获取 token

2. 计算分片 Hash（前端）
   → 获取每个分片的 Hash 值

3. 检测分片是否存在
   POST /file/patchHash (isChunk: true)
   → 部分分片 exists: true，部分 exists: false

4. 仅上传不存在的分片
   POST /file/uploadChunk
   → 只上传 exists: false 的分片

5. 重复步骤 3-4 直到所有分片就绪

6. 合并文件
   POST /file/merge
   → 合并所有分片，完成上传
```

## 错误处理

### 错误响应格式

```json
{
  "statusCode": 400,
  "message": "Invalid token",
  "error": "Bad Request"
}
```

### 常见错误码

- `400 Bad Request` - 请求参数错误
- `401 Unauthorized` - 未授权（如果实现了认证）
- `404 Not Found` - 资源不存在
- `500 Internal Server Error` - 服务器内部错误

### 错误处理建议

1. **Token 验证失败**: 重新创建会话
2. **分片上传失败**: 重试上传该分片
3. **合并失败**: 检查分片是否完整，重新合并
4. **网络错误**: 实现重试机制

## 安全考虑

### 1. Token 安全

- Token 应该是随机且不可预测的
- Token 应该有有效期（可选）
- Token 应该验证来源（可选）

### 2. 文件验证

- 验证文件类型和大小
- 验证分片数量和大小
- 防止恶意上传

### 3. 速率限制

- 限制单个 IP 的上传速率
- 限制单个 token 的上传频率
- 防止 DDoS 攻击

## 扩展协议

### 自定义头部

可以在请求中添加自定义头部：

```http
POST /file/create
Content-Type: application/json
X-Custom-Header: value
```

### 认证支持

可以在请求中添加认证信息：

```http
POST /file/create
Content-Type: application/json
Authorization: Bearer <token>
```

## 协议版本

当前协议版本：**v1.0**

未来可能会添加：
- 协议版本标识
- 向后兼容机制
- 新功能支持

## 实现建议

### 前端实现

1. 使用统一的 API 客户端封装所有请求
2. 实现请求重试机制
3. 处理网络错误和超时
4. 支持取消请求

### 后端实现

1. 验证所有请求参数
2. 实现 Token 验证机制
3. 处理并发上传
4. 实现错误处理和日志记录

## 总结

通信协议设计考虑了：
- ✅ 简洁明了，易于实现
- ✅ 支持断点续传和文件秒传
- ✅ 具有良好的扩展性
- ✅ 统一的错误处理机制
