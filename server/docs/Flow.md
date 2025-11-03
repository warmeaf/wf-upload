# 接口流程图

本文档包含所有4个接口的详细逻辑流程图，展示每个接口的关键步骤和决策点。

## 1. 会话创建接口 (`/file/create`)

创建文件上传会话，生成唯一token并初始化文件记录。

```mermaid
flowchart TD
    A[客户端请求 POST /file/create] --> B[接收请求体:<br/>fileName, fileType, fileSize, chunksLength]
    B --> C[调用 UniqueCodeService.generateUniqueCode]
    C --> D{生成token成功?}
    D -->|否| E[抛出异常: Failed to generate token<br/>HTTP 500]
    D -->|是| F[调用 FileService.createFile]
    F --> G["创建文件记录到数据库:<br/>token, fileName, fileType,<br/>fileSize, chunksLength,<br/>fileHash='', chunks=空数组, url=''"]
    G --> H[记录日志: File session created]
    H --> I[返回响应:<br/>code: 200, token]
    I --> J[结束]
    E --> J

    style A fill:#e1f5ff
    style I fill:#c8e6c9
    style E fill:#ffcdd2
```

### 关键步骤说明

1. **接收请求参数**: 文件名、文件类型、文件大小、分块总数
2. **生成唯一token**: 使用UUID + JWT签名，有效期1小时
3. **创建数据库记录**: 在file集合中创建初始记录，状态字段为空
4. **返回token**: 客户端使用token进行后续操作

---

## 2. 分块/文件状态检查接口 (`/file/patchHash`)

检查特定分块或整个文件是否已存在于服务器（用于秒传功能）。

```mermaid
flowchart TD
    A[客户端请求 POST /file/patchHash] --> B[接收请求体:<br/>token, hash, isChunk]
    B --> C[调用 UniqueCodeService.verifyUniqueCode]
    C --> D{Token有效?}
    D -->|否| E[抛出异常: Invalid token<br/>HTTP 400]
    D -->|是| F{isChunk === true?}
    F -->|是| G[调用 FileService.checkChunkExists]
    F -->|否| H[调用 FileService.checkFileExists]
    G --> I[查询 fileChunks 集合:<br/>countDocuments where hash = hash]
    H --> J[查询 file 集合:<br/>countDocuments where fileHash = hash]
    I --> K{count > 0?}
    J --> K
    K -->|是| L[exists = true]
    K -->|否| M[exists = false]
    L --> N[记录日志: Chunk/File hash check]
    M --> N
    N --> O[返回响应:<br/>code: 200, exists]
    O --> P[结束]
    E --> P

    style A fill:#e1f5ff
    style O fill:#c8e6c9
    style E fill:#ffcdd2
    style F fill:#fff9c4
    style K fill:#fff9c4
```

### 关键步骤说明

1. **验证token**: 确保请求来自有效的上传会话
2. **判断检查类型**: 根据isChunk字段决定检查分块还是文件
3. **查询数据库**:
   - 分块检查：查询fileChunks集合
   - 文件检查：查询file集合的fileHash字段
4. **返回存在状态**: 告知客户端是否已存在，用于跳过重复上传

---

## 3. 分块上传接口 (`/file/uploadChunk`)

上传单个文件分块，支持去重机制。

```mermaid
flowchart TD
    A[客户端请求 POST /file/uploadChunk<br/>FormData: token, chunk, hash] --> B[接收FormData数据]
    B --> C[调用 UniqueCodeService.verifyUniqueCode]
    C --> D{Token有效?}
    D -->|否| E[抛出异常: Invalid token<br/>HTTP 400]
    D -->|是| F{chunk数据存在?}
    F -->|否| G[抛出异常: No chunk data provided<br/>HTTP 400]
    F -->|是| H[调用 FileService.saveChunk]
    H --> I[查询 fileChunks 集合:<br/>findOne where hash = hash]
    I --> J{分块已存在?}
    J -->|是| K[记录日志: Chunk already exists, skipping save]
    J -->|否| L[创建新的 FileChunkDocument:<br/>hash, chunk Buffer]
    L --> M[保存到 fileChunks 集合]
    M --> N[记录日志: Chunk saved successfully]
    K --> O[记录日志: Chunk uploaded]
    N --> O
    O --> P[返回响应:<br/>code: 200, success: true]
    P --> Q[结束]
    E --> Q
    G --> Q

    style A fill:#e1f5ff
    style P fill:#c8e6c9
    style E fill:#ffcdd2
    style G fill:#ffcdd2
    style J fill:#fff9c4
    style F fill:#fff9c4
```

### 关键步骤说明

1. **验证token**: 确保请求来自有效的上传会话
2. **验证分块数据**: 检查chunk buffer是否存在
3. **去重检查**: 先查询fileChunks集合，避免重复存储相同hash的分块
4. **保存分块**: 如果不存在则创建新记录并保存二进制数据
5. **返回成功**: 无论是否已存在都返回成功（幂等性）

---

## 4. 文件合并接口 (`/file/merge`)

合并所有分块，完成文件上传流程。

```mermaid
flowchart TD
    A[客户端请求 POST /file/merge] --> B[接收请求体:<br/>token, fileHash, fileName,<br/>chunksLength, chunks数组]
    B --> C[调用 UniqueCodeService.verifyUniqueCode]
    C --> D{Token有效?}
    D -->|否| E[抛出异常: Invalid token<br/>HTTP 400]
    D -->|是| F{chunks.length === chunksLength?}
    F -->|否| G[抛出异常: Chunks count mismatch<br/>HTTP 400]
    F -->|是| H[调用 FileService.updateFileForMerge]
    H --> I[生成文件URL:<br/>文件名不含扩展名 + '_' + fileHash + 扩展名]
    I --> J[更新 file 集合记录:<br/>where token = token<br/>set: fileHash, chunks, url]
    J --> K[记录日志: File merge completed]
    K --> L[返回响应:<br/>code: 200, url]
    L --> M[结束]
    E --> M
    G --> M

    style A fill:#e1f5ff
    style L fill:#c8e6c9
    style E fill:#ffcdd2
    style G fill:#ffcdd2
    style F fill:#fff9c4
    style D fill:#fff9c4
```

### 关键步骤说明

1. **验证token**: 确保请求来自有效的上传会话
2. **验证分块数量**: 确保chunks数组长度与chunksLength一致
3. **生成文件URL**: 格式为 `文件名_fileHash.扩展名`
4. **更新数据库记录**: 填充fileHash、chunks数组和url字段
5. **返回文件URL**: 客户端可使用此URL访问上传完成的文件

---

## 完整上传流程总览

```mermaid
sequenceDiagram
    participant Client as 客户端
    participant API as API接口
    participant TokenService as Token服务
    participant FileService as 文件服务
    participant DB as 数据库

    Note over Client,DB: 1. 创建上传会话
    Client->>API: POST /file/create<br/>(fileName, fileType, fileSize, chunksLength)
    API->>TokenService: generateUniqueCode()
    TokenService-->>API: token (JWT)
    API->>FileService: createFile(token, ...)
    FileService->>DB: 创建file记录
    DB-->>FileService: 保存成功
    FileService-->>API: 文件记录
    API-->>Client: {code: 200, token}

    Note over Client,DB: 2. 检查分块/文件是否存在（可并行执行）
    loop 对每个分块
        Client->>API: POST /file/patchHash<br/>(token, hash, isChunk=true)
        API->>TokenService: verifyUniqueCode(token)
        TokenService-->>API: valid
        API->>FileService: checkChunkExists(hash)
        FileService->>DB: 查询fileChunks集合
        DB-->>FileService: exists
        FileService-->>API: exists
        API-->>Client: {code: 200, exists}
    end

    Note over Client,DB: 3. 上传分块（可并行执行）
    loop 对每个不存在的分块
        Client->>API: POST /file/uploadChunk<br/>(FormData: token, chunk, hash)
        API->>TokenService: verifyUniqueCode(token)
        TokenService-->>API: valid
        API->>FileService: saveChunk(chunk, hash)
        FileService->>DB: 检查分块是否存在
        alt 分块不存在
            FileService->>DB: 保存分块到fileChunks
            DB-->>FileService: 保存成功
        else 分块已存在
            FileService->>FileService: 跳过保存
        end
        FileService-->>API: 成功
        API-->>Client: {code: 200, success: true}
    end

    Note over Client,DB: 4. 合并文件
    Client->>API: POST /file/merge<br/>(token, fileHash, fileName, chunks)
    API->>TokenService: verifyUniqueCode(token)
    TokenService-->>API: valid
    API->>API: 验证chunks.length === chunksLength
    API->>FileService: updateFileForMerge(token, fileHash, fileName, chunks)
    FileService->>FileService: 生成URL: fileName_fileHash.ext
    FileService->>DB: 更新file记录<br/>(fileHash, chunks, url)
    DB-->>FileService: 更新成功
    FileService-->>API: url
    API-->>Client: {code: 200, url}
```

---

## 错误处理流程

所有接口遵循统一的错误处理机制：

```mermaid
flowchart TD
    A[接口调用] --> B{验证token}
    B -->|无效| C[返回 HTTP 400: Invalid token]
    B -->|有效| D{业务逻辑执行}
    D -->|成功| E[返回 HTTP 200 + 数据]
    D -->|业务错误| F[返回对应HTTP状态码 + 错误信息]
    D -->|系统异常| G[记录错误日志]
    G --> H[抛出HTTP异常]
    H --> I[返回 HTTP 500 或对应状态码]

    style E fill:#c8e6c9
    style C fill:#ffcdd2
    style F fill:#ffcdd2
    style I fill:#ffcdd2
```

---

## 数据库集合说明

### file 集合

- **用途**: 存储文件上传会话和最终文件信息
- **关键字段**: token, fileName, fileType, fileSize, chunksLength, fileHash, chunks[], url

### fileChunks 集合

- **用途**: 存储所有文件分块的二进制数据
- **关键字段**: hash, chunk (Buffer)
- **特点**: 支持去重，相同hash的分块只存储一次