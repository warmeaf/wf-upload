# 大文件分片上传流程

## 整体流程

核心思想是并发计算 Hash 与上传分片，并将文件秒传的检查时机提前。

### 文字描述

1.  **文件校验与会话创建**:
    - 用户选择文件后，进行基本校验：检查文件是否存在、文件大小是否为 0（不允许空文件）。
    - 校验通过后，请求 `/file/create` 接口创建上传会话，传递文件名、文件大小、文件类型和总分片数。
    - 服务端返回用于后续所有请求身份验证的 `token`，上传器状态切换为 `uploading`。

2.  **分片与 Hash 计算 (Worker 线程)**:
    - 文件按照配置的 `chunkSize` 被切割成多个分片（最后一个分片可能小于 `chunkSize`）。
    - 在独立的 Worker 线程中，逐个计算分片的 Hash（避免阻塞主线程）。
    - 每计算完一个分片，抛出 `ChunkHashed` 事件，并附带分片信息（索引、Hash、数据等）。
    - 所有分片 Hash 计算完毕后，抛出 `AllChunksHashed` 事件，标记不再有新任务产生。
    - 随后，计算出整个文件的 Hash 并抛出 `FileHashed` 事件（单线程模式下由 Worker 计算，多线程模式下由主线程汇总计算）。
    - 如果 Hash 计算过程中出现任何错误，Worker 会抛出错误消息，触发 `QueueAborted` 事件。

3.  **并发上传队列**:
    - 主线程监听 `ChunkHashed` 事件，每接收到一个事件，就将一个分片上传任务推入并发队列。
    - 队列有并发限制（例如，同时最多上传 N 个分片），超过限制的任务处于 `pending` 状态等待调度。
    - 队列会自动处理：当有可用并发槽位时，将 `pending` 任务转为 `inFlight` 状态并开始执行。
    - 每个队列任务首先请求 `/file/patchHash`（`isChunk: true`）检查分片是否已存在于服务端（分片秒传）。
      - **已存在**: 该分片标记为上传成功（`completed`），无需重复上传，更新上传进度。
      - **不存在**: 请求 `/file/uploadChunk` 上传分片。上传成功后标记为完成，更新上传进度。
    - 若任一分片检查或上传失败，立即中止队列：取消所有未开始的任务，忽略进行中任务的结果，设置 `failed` 计数，并抛出 `QueueAborted` 事件。
    - 当满足所有完成条件时（见下方"队列全部处理完成的判定条件"），队列会抛出 `QueueDrained` 事件。

4.  **文件秒传检查**:
    - 主线程监听 `FileHashed` 事件，接收到文件 Hash 后，立即请求 `/file/patchHash`（`isChunk: false`）检查文件是否已存在于服务端。
    - **文件已存在 (秒传)**:
      - 终止 Worker 线程（释放资源）。
      - 如果并发队列中仍有正在上传或待上传的任务，将队列状态更改为全部已完成（所有任务标记为完成，设置统计为完成状态），触发 `QueueDrained` 事件，直接进入合并阶段。
      - 如果队列已经自然完成，则无需额外操作。
    - **文件不存在**:
      - 继续等待队列自然完成，不做额外操作。

5.  **最终合并**:
    - 主线程监听 `QueueDrained` 事件。
    - 收到事件后，检查是否已经合并过（防止重复合并）。
    - 如果尚未合并，先检查本地文件 Hash 是否已经存在：
      - **文件 Hash 不存在**: 将所有分片 Hash 按分片顺序（索引顺序）增量计算作为文件 Hash。
      - **文件 Hash 已存在**: 直接使用已有的文件 Hash。
    - 准备合并请求：包含 `token`、`fileHash`、`fileName`、`chunksLength` 和所有分片信息（每个分片的索引和 Hash）。
    - 请求 `/file/merge` 接口，通知服务端合并所有分片。
    - 合并成功后，服务端返回下载 URL，上传器状态切换为 `completed`，整个上传过程完成。

> **注意**:
>
> - 只有在所有分片都成功处理（`failed === 0`）的情况下，才能触发 `QueueDrained` 事件及后续的合并请求。
> - 整个流程中，主线程会持续更新上传进度（已计算 Hash 的分片数、已上传的分片数、总分片数），并通过回调函数通知外部。
> - 如果用户主动中止上传，会终止 Worker 线程，将状态设置为 `failed`，并中止队列调度（忽略进行中的任务）。

### 流程图 (Mermaid)

```mermaid
flowchart TD
    A[开始 / 选择文件] --> VALIDATE{文件校验<br/>文件存在?<br/>size > 0?}
    VALIDATE -->|校验失败| ERROR[抛出错误]
    VALIDATE -->|校验通过| INIT[初始化状态<br/>status: uploading]
    INIT --> C0[/创建会话 /file/create/<br/>传递: fileName, fileSize,<br/>fileType, chunksLength/]
    C0 -->|获取 token| B[按 chunkSize 切片]

    subgraph WORKER[Worker 线程]
        direction TB
        W1[逐个计算分片 Hash] -->|每完成一个| W1E[抛出 ChunkHashed 事件<br/>附带: chunk信息]
        W1 -->|全部完成| W1A[抛出 AllChunksHashed 事件]
        W1A --> W2[计算文件 Hash<br/>(单线程:Worker / 多线程:主线程)]
        W2 --> W2E[抛出 FileHashed 事件<br/>附带: fileHash]
        W1 -.->|计算错误| W_ERR[抛出错误消息]
    end

    B --> W1
    W_ERR -.-> ABORT_WORKER[触发 QueueAborted]

    subgraph LISTENER[主线程监听器]
        direction TB
        L1[监听 ChunkHashed] --> L1A[存储分片 Hash<br/>更新进度: chunksHashed++]
        L1A --> L1B[将分片任务推入并发队列<br/>status: pending]

        L2[监听 FileHashed] --> L2A[存储文件 Hash]
        L2A --> L2B[/检查文件秒传 /file/patchHash/<br/>isChunk: false/]

        L3[监听 QueueDrained] --> L3A{是否已合并?}
        L3A -->|是| L3B[忽略重复]
        L3A -->|否| L3_CALC_HASH{文件 Hash 是否存在?}
        L3_CALC_HASH -->|否| L3_CALC[增量计算文件 Hash<br/>按索引顺序合并所有分片 Hash]
        L3_CALC --> L3C[准备合并请求<br/>token, fileHash, fileName,<br/>chunksLength, chunks数组]
        L3_CALC_HASH -->|是| L3C
        L3C --> L3D[/合并分片 /file/merge/]
        L3D -->|成功| L3E[获取下载 URL<br/>status: completed]
        L3E --> L3F[完成上传]
    end

    W1E -.->|事件| L1
    W2E -.->|事件| L2

    subgraph QUEUE[并发队列（限流 N）]
        direction TB
        Q_START[新任务加入队列<br/>pending++]
        Q_START --> Q_CHECK{是否有可用并发槽位?<br/>inFlight < N}
        Q_CHECK -->|否| Q_WAIT[等待槽位释放]
        Q_WAIT --> Q_CHECK
        Q_CHECK -->|是| Q_START_TASK[启动任务<br/>pending--, inFlight++<br/>status: inFlight]
        Q_START_TASK --> C2[/检查分片 /file/patchHash/<br/>isChunk: true/]
        C2 -->|已存在| C4[标记成功<br/>inFlight--, completed++<br/>更新进度: chunksUploaded++]
        C2 -->|不存在| C3[/上传分片 /file/uploadChunk/<br/>传递: token, hash, blob/]
        C3 -->|成功| C4
        C3 -->|失败| QA[设置 failed++<br/>中止队列<br/>抛出 QueueAborted 事件]
        C4 --> QC{队列是否全部成功完成?<br/>allChunksHashed=true<br/>pending=0<br/>inFlight=0<br/>failed=0<br/>completed=totalChunks}
        QC -->|是| QD[抛出 QueueDrained 事件]
        QC -->|否| Q_NEXT{还有待处理任务?}
        Q_NEXT -->|是| Q_CHECK
        Q_NEXT -->|否| Q_WAIT_COMPLETE[等待其他任务完成]
    end

    L1B --> Q_START
    QA -.->|事件| ABORT[终止上传<br/>status: failed]
    QD -.->|事件| L3

    subgraph FILE_CHECK[文件秒传处理]
        direction TB
        L2B -->|文件已存在| F1[终止 Worker 线程]
        F1 --> F2{队列是否已完成?<br/>completed === totalChunks}
        F2 -->|否| FC[设置队列为完成状态<br/>所有 pending 任务标记为 completed<br/>设置统计: pending=0, inFlight=0<br/>failed=0, completed=totalChunks<br/>更新进度: chunksUploaded=totalChunks]
        FC --> FE[触发 QueueDrained 事件]
        F2 -->|是| FD[无需操作]
        FE -.->|事件| L3

        L2B -->|文件不存在| F5[继续等待队列自然完成]
    end

    F5 -.-> QD
    FD -.-> L3B

    subgraph USER_ABORT[用户中止]
        direction TB
        UA[用户调用 abort] --> UA1[终止 Worker 线程]
        UA1 --> UA2[中止队列<br/>停止调度新任务]
        UA2 --> UA3[status: failed]
    end

    style ERROR fill:#ffcccc
    style ABORT fill:#ffcccc
    style ABORT_WORKER fill:#ffcccc
    style QA fill:#ffcccc
    style UA3 fill:#ffcccc
    style L3F fill:#ccffcc
    style L3E fill:#ccffcc
```

## 事件与状态定义

### 事件

- **ChunkHashed**：单个分片 Hash 完成，产生一个队列任务。事件包含分片信息（索引、Hash、数据 Blob 等）。
- **AllChunksHashed**：所有分片 Hash 已产生，不再新增任务。队列据此判断是否还会有新任务加入。
- **FileHashed**：文件 Hash 完成。事件包含完整的文件 Hash 值。
- **QueueDrained**：并发队列全部成功完成（无任何失败）。触发合并流程。
- **QueueAborted**：出现不可恢复失败，队列被中止（失败路径）。终止整个上传流程。

### 上传器状态

上传器在整个流程中会处于以下状态之一：

- **idle**：初始状态，未开始上传。
- **uploading**：正在上传中，包括 Hash 计算和分片上传阶段。
- **completed**：上传成功完成，已获取下载 URL。
- **failed**：上传失败，可能是校验失败、网络错误、用户中止等原因。

### 进度信息

上传过程中会持续更新以下进度信息：

- **chunksHashed**：已计算 Hash 的分片数量。
- **chunksUploaded**：已上传的分片数量（包括秒传跳过的分片）。
- **totalChunks**：总分片数量。

### 队列统计计数

- **totalChunks**：总分片数（等于队列中的任务总数）。
- **pending**：待调度任务数（处于等待状态的任务）。
- **inFlight**：执行中的任务数（正在检查或上传的任务）。
- **completed**：成功任务数（含"已存在跳过"的成功路径）。
- **failed**：失败任务数（仅用于报警/中止，不参与"完成"状态）。
- **allChunksHashed**：布尔值，标记所有分片 Hash 是否已计算完成。

队列全部处理完成的判定条件

- allChunksHashed === true （已经确定不会再新增任务）
- pending === 0 （无待开始任务）
- inFlight === 0 （无执行中的任务）
- failed === 0 （没有任何失败）
- completed === totalChunks （全部任务均成功）

满足上述条件才触发 QueueDrained 。否则：

- 一旦 failed > 0 ，立即触发 QueueAborted 并中止后续流程（见下文“失败处理”）。

失败处理（不允许失败）

- 单任务失败时：当任务失败时，设置 failed++ ，立即中止队列并发出 QueueAborted ，取消一切未开始和进行中的任务，标记上传失败。
- 不将"失败"视为"完成"的一部分；失败不会触发 QueueDrained 。
- 任一分片 Hash 或文件 Hash 计算失败/中断，视为不可恢复失败，直接触发 QueueAborted。

## API 接口说明

### 会话创建

- **接口**：`POST /file/create`
- **请求参数**：`fileName`（文件名）、`fileSize`（文件大小）、`fileType`（文件类型）、`chunksLength`（总分片数）
- **响应**：`token`（会话令牌，用于后续所有请求的身份验证）

### 分片检查

- **接口**：`POST /file/patchHash`
- **请求参数**：`token`（会话令牌）、`hash`（Hash 值）、`isChunk`（`true` 表示检查分片，`false` 表示检查文件）
- **响应**：`exists`（布尔值，表示是否存在）

### 分片上传

- **接口**：`POST /file/uploadChunk`
- **请求参数**：通过 `FormData` 传递 `token`、`hash`、`chunk`（分片 Blob 数据）
- **响应**：`success`（布尔值，表示是否成功）

### 文件合并

- **接口**：`POST /file/merge`
- **请求参数**：`token`（会话令牌）、`fileHash`（文件 Hash）、`fileName`（文件名）、`chunksLength`（总分片数）、`chunks`（分片信息数组，每个元素包含 `index` 和 `hash`）
- **响应**：`url`（下载 URL）

## 边界情况

- **不允许空文件**：不允许空文件上传（`size === 0`），会在文件校验阶段被拒绝。
- **文件不存在**：如果文件对象不存在，会在文件校验阶段被拒绝。
- **网络错误**：任何 API 请求失败都会触发 `QueueAborted` 事件，终止上传流程。
- **Worker 错误**：Worker 线程中的任何错误（如文件读取失败、Hash 计算失败）都会触发 `QueueAborted` 事件。
- **重复合并保护**：合并逻辑中包含检查机制，防止重复合并请求。
- **并发限制**：队列会根据配置的并发数自动调度任务，超过限制的任务会等待可用槽位。

## 分片和文件 hash 计算

### 依赖库

- **Spark-MD5.js**：用于计算 MD5 Hash 值

### Hash 计算规范

#### 分片 Hash

- **算法**：对每个分片的二进制数据计算 MD5（使用 `SparkMD5.ArrayBuffer`）
- **输出格式**：小写十六进制字符串，长度为 32 字符
- **计算时机**：在 Worker 线程中逐个计算，每完成一个立即抛出事件
- **计算顺序**：按照分片索引顺序依次计算

#### 文件 Hash

- **算法**：将所有分片 Hash 按分片索引顺序进行增量计算
- **计算方式**：使用 SparkMD5 的增量更新机制，依次 `append` 每个分片的 Hash 值，最后调用 `end()` 获取最终 Hash
- **输出格式**：小写十六进制字符串，长度为 32 字符
- **计算时机**：在所有分片 Hash 计算完成后进行（单线程模式在 Worker 中计算，多线程模式在主线程中计算）
- **备用计算**：如果文件 Hash 在 Worker 中计算失败或未完成，主线程会在合并前从已存储的分片 Hash 增量计算

#### 分片大小

- **规范**：使用固定的 `chunkSize`（配置参数）
- **最后一个分片**：可能小于 `chunkSize`（文件大小不是 `chunkSize` 的整数倍时）
- **一致性要求**：`chunkSize` 必须在客户端与服务端保持一致，以保证"秒传"检查的一致性

#### Hash 计算失败/中断策略

- **分片 Hash 失败**：任一分片 Hash 计算失败，Worker 会抛出错误消息，触发 `QueueAborted` 事件
- **文件 Hash 失败**：文件 Hash 计算失败，Worker 会抛出错误消息，触发 `QueueAborted` 事件
- **Worker 中断**：Worker 线程被终止或出现运行时错误，会触发 `QueueAborted` 事件
- **不可恢复性**：所有 Hash 计算错误都被视为不可恢复的失败，不会重试
