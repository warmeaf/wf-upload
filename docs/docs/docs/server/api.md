# API 接口文档

后端提供 4 个核心 API 接口，遵循 RESTful 设计原则。

## 基础信息

- **Base URL**: `http://localhost:3000/api/file`
- **Content-Type**: `application/json` (除上传分片接口外)
- **响应格式**: JSON

## 1. 创建上传会话

创建新的文件上传会话，获取上传 token。

### 接口信息

- **URL**: `/file/create`
- **Method**: `POST`
- **Content-Type**: `application/json`

### 请求参数

```typescript
{
  fileName: string      // 文件名（必填）
  fileType: string      // 文件类型/MIME（必填）
  fileSize: number      // 文件大小，单位字节（必填）
  chunksLength: number   // 分片数量（必填，>= 1）
}
```

### 请求示例

```bash
curl -X POST http://localhost:3000/api/file/create \
  -H "Content-Type: application/json" \
  -d '{
    "fileName": "example.pdf",
    "fileType": "application/pdf",
    "fileSize": 10485760,
    "chunksLength": 5
  }'
```

### 响应

**成功响应 (200):**

```typescript
{
  code: 200
  token: string  // 上传会话 token
}
```

**响应示例:**

```json
{
  "code": 200,
  "token": "550e8400-e29b-41d4-a716-446655440000"
}
```

**错误响应:**

- `400 Bad Request` - 参数验证失败
- `500 Internal Server Error` - 服务器错误

### 说明

- Token 用于后续所有上传操作的身份标识
- Token 在数据库中创建对应的文件记录
- 同一文件多次上传会创建不同的 token

## 2. 检测分片/文件是否存在

检测指定 Hash 值的分片或文件是否已存在于服务器。

### 接口信息

- **URL**: `/file/patchHash`
- **Method**: `POST`
- **Content-Type**: `application/json`

### 请求参数

```typescript
{
  token: string    // 上传会话 token（必填）
  hash: string    // Hash 值（必填）
  isChunk: boolean // 是否为分片 Hash（必填）
                  // true: 检测分片, false: 检测文件
}
```

### 请求示例

**检测分片:**

```bash
curl -X POST http://localhost:3000/api/file/patchHash \
  -H "Content-Type: application/json" \
  -d '{
    "token": "550e8400-e29b-41d4-a716-446655440000",
    "hash": "abc123def456...",
    "isChunk": true
  }'
```

**检测文件:**

```bash
curl -X POST http://localhost:3000/api/file/patchHash \
  -H "Content-Type: application/json" \
  -d '{
    "token": "550e8400-e29b-41d4-a716-446655440000",
    "hash": "filehash123...",
    "isChunk": false
  }'
```

### 响应

**成功响应 (200):**

```typescript
{
  code: 200
  exists: boolean  // 是否存在
}
```

**响应示例:**

```json
{
  "code": 200,
  "exists": true
}
```

**错误响应:**

- `400 Bad Request` - Token 无效或参数错误
- `500 Internal Server Error` - 服务器错误

### 说明

- 用于实现断点续传和文件秒传
- 分片检测用于跳过已上传的分片
- 文件检测用于实现文件秒传功能

## 3. 上传分片

上传单个文件分片。

### 接口信息

- **URL**: `/file/uploadChunk`
- **Method**: `POST`
- **Content-Type**: `multipart/form-data`

### 请求参数

**FormData 字段:**

- `token: string` - 上传会话 token（必填）
- `hash: string` - 分片 Hash 值（必填）
- `chunk: File` - 分片文件数据（必填）

### 请求示例

```bash
curl -X POST http://localhost:3000/api/file/uploadChunk \
  -F "token=550e8400-e29b-41d4-a716-446655440000" \
  -F "hash=abc123def456..." \
  -F "chunk=@chunk.bin"
```

**JavaScript 示例:**

```typescript
const formData = new FormData()
formData.append('token', token)
formData.append('hash', chunkHash)
formData.append('chunk', chunkBlob)

const response = await fetch('http://localhost:3000/api/file/uploadChunk', {
  method: 'POST',
  body: formData,
})
```

### 响应

**成功响应 (200):**

```typescript
{
  code: 200
  success: boolean
}
```

**响应示例:**

```json
{
  "code": 200,
  "success": true
}
```

**错误响应:**

- `400 Bad Request` - Token 无效、Hash 错误或缺少分片数据
- `500 Internal Server Error` - 服务器错误

### 说明

- 分片数据通过 FormData 上传
- 如果分片已存在（Hash 相同），会跳过存储
- 分片数据存储在 MongoDB 的 `FileChunk` 集合中

## 4. 合并文件

合并所有分片，完成文件上传。

### 接口信息

- **URL**: `/file/merge`
- **Method**: `POST`
- **Content-Type**: `application/json`

### 请求参数

```typescript
{
  token: string              // 上传会话 token（必填）
  fileHash: string           // 文件 Hash 值（必填）
  fileName: string           // 文件名（必填）
  chunksLength: number       // 分片数量（必填，>= 1）
  chunks: ChunkDto[]         // 分片信息数组（必填）
}

interface ChunkDto {
  index: number  // 分片索引
  hash: string   // 分片 Hash
}
```

### 请求示例

```bash
curl -X POST http://localhost:3000/api/file/merge \
  -H "Content-Type: application/json" \
  -d '{
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
  }'
```

### 响应

**成功响应 (200):**

```typescript
{
  code: 200
  url: string  // 文件访问地址
}
```

**响应示例:**

```json
{
  "code": 200,
  "url": "example_abc123def456.pdf"
}
```

**错误响应:**

- `400 Bad Request` - Token 无效、分片数量不匹配或参数错误
- `500 Internal Server Error` - 服务器错误

### 说明

- 合并时会验证分片数量和顺序
- 文件 URL 基于文件名和 Hash 值生成
- 合并完成后，文件记录会更新，包含完整的文件信息

## 错误处理

所有接口使用统一的错误响应格式：

```typescript
{
  statusCode: number    // HTTP 状态码
  message: string       // 错误消息
  error?: string        // 错误类型（可选）
}
```

### 常见错误

- **400 Bad Request**: 参数验证失败
  - Token 无效
  - 必填参数缺失
  - 参数类型错误

- **500 Internal Server Error**: 服务器内部错误
  - 数据库连接失败
  - 文件存储失败
  - 其他服务器错误

## 完整上传流程示例

```typescript
// 1. 创建会话
const createResponse = await fetch('http://localhost:3000/api/file/create', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    fileName: 'example.pdf',
    fileType: 'application/pdf',
    fileSize: 10485760,
    chunksLength: 5,
  }),
})
const { token } = await createResponse.json()

// 2. 检测分片是否存在
const checkChunkResponse = await fetch('http://localhost:3000/api/file/patchHash', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    token,
    hash: chunkHash,
    isChunk: true,
  }),
})
const { exists } = await checkChunkResponse.json()

// 3. 如果不存在，上传分片
if (!exists) {
  const formData = new FormData()
  formData.append('token', token)
  formData.append('hash', chunkHash)
  formData.append('chunk', chunkBlob)
  
  await fetch('http://localhost:3000/api/file/uploadChunk', {
    method: 'POST',
    body: formData,
  })
}

// 4. 检测文件是否存在（秒传）
const checkFileResponse = await fetch('http://localhost:3000/api/file/patchHash', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    token,
    hash: fileHash,
    isChunk: false,
  }),
})

// 5. 合并文件
const mergeResponse = await fetch('http://localhost:3000/api/file/merge', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    token,
    fileHash,
    fileName: 'example.pdf',
    chunksLength: 5,
    chunks: chunksInfo,
  }),
})
const { url } = await mergeResponse.json()
```
