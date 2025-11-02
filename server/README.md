# 大文件上传后端逻辑

本文档概述了支持前端并发哈希计算和分块文件上传所需的后端逻辑。

## 核心 API 端点

### 1. 会话创建 (`/file/create`)

- **方法**: `POST`
- **目的**: 为新文件初始化上传会话。
- **请求体**:
  ```json
  {
    "fileName": "example.zip",
    "fileType": "zip",
    "fileSize": 104857600,
    "chunksLength": 20
  }
  ```
- **过程**:
  1.  生成一个唯一的 `token`，作为整个上传会话的标识符。
  2.  在数据库的`file`集合中创建一个与 `token` 关联的记录，以跟踪上传状态。该记录的字段如下：
  - `token`: 会话令牌，唯一标识上传会话。
  - `fileName`: 上传的文件名。
  - `fileType`: 文件类型（例如，`zip`、`tar.gz` 等）。
  - `fileSize`: 文件总大小（字节）。
  - `chunksLength`: 分块总数。
  - `fileHash`: 文件的哈希值，初始为空。
  - `chunks`: 已上传分块的哈希值数组，初始为空。每一项包括：
    - `index`: 分块的序列号。
    - `hash`: 分块的哈希值。
  - `url`: 上传完成后的文件 URL，初始为空。
- **响应**:

  ```json
  {
    "code": 200,
    "token": "unique-session-token-12345"
  }
  ```

### 2. 分块/文件状态检查 (`/file/patchHash`)

- **方法**: `POST`
- **目的**: 一个多功能端点，用于检查特定分块或整个文件是否已存在于服务器上（用于“秒传”）。
- **请求体**:

  ```json
  {
    "token": "unique-session-token-12345",
    "hash": "chunk-or-file-hash-abcdef",
    "isChunk": true
  }
  ```

  - `isChunk`: 检查分块时设置为 `true`，检查整个文件时设置为 `false`。

- **过程**:
  1.  在存储系统中查找提供的 `hash`。
  2.  如果 `isChunk` 为 `true`，则检查相应的分块`hash`是否存在于集合`chunks`中。
  3.  如果 `isChunk` 为 `false`，则根据`token`检查相应的文件`hash`是否存在于集合`file`中。
- **响应**:

  ```json
  {
    "code": 200,
    "exists": true
  }
  ```

### 3. 分块上传 (`/file/uploadChunk`)

- **方法**: `POST`
- **目的**: 上传单个文件分块。
- **请求体**: 一个 `FormData` 对象，包含：
  - `token`: 会话令牌。
  - `chunk`: 文件分块的二进制数据。
  - `hash`: 用于完整性验证的分块哈希。
- **过程**:
  1.  接收分块数据。
  2.  检查集合`chunks`中是否存在请求中提供的 `hash`。
  3.  如果不存在则存储到集合`chunks`中，字段如下：
  - `hash`: 分块的哈希值。
  - `chunk`: 文件分块的二进制数据。
  4.  如果分块已存在，则什么也不用做，返回成功响应即可。
- **响应**:

  ```json
  {
    "code": 200,
    "success": true
  }
  ```

### 4. 文件合并 (`/file/merge`)

- **方法**: `POST`
- **目的**: 表示文件上传的最后步骤。
- **请求体**:
  ```json
  {
    "token": "unique-session-token-12345",
    "fileHash": "final-file-hash-ghijkl",
    "fileName": "example.zip",
    "chunksLength": 20,
    "chunks": [
      {
        "index": 0,
        "hash": "chunk-hash-1"
      },
      {
        "index": 1,
        "hash": "chunk-hash-2"
      },
      ...
    ],
  }
  ```
- **过程**:
  1. 进行相关验证。
  2. 根据`token`更新会话记录，将 `fileHash`、`chunks`、`url` 字段填充。
     - `fileHash`: 上传的文件哈希值。
     - `chunks`: 上传的分块的哈希值数组。
     - `url`: 上传完成后的文件 URL，文件名 + 下划线 + 32 位文件哈希值 + 文件后缀。
- **响应**:
  ```json
  {
    "code": 200,
    "url": "example_erdfghyutfvbgty64rtyghbnjkiuyhfrd3.zip"
  }
  ```
