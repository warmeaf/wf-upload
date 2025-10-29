# 大文件分片上传流程

## 整体流程

用户选择文件后，首先调用 /file/create 创建上传会话，服务端返回 token。后续的分片哈希校验、分片上传与最终合并等所有请求均需携带该 token，用于会话校验与文件关联。

分片完成后，立即在 Worker 中计算分片 hash。每计算完一个分片 hash，抛出事件 ChunkHashed，将该分片任务推入“并发队列（限流 N）”。队列对每个分片执行：先调用 /file/patchHash(type='chunk') 检查是否已存在；已存在则由服务端以幂等方式建立当前 token 与该分片哈希的关联（若已存在则跳过），然后标记成功并跳过上传；不存在则调用 /file/uploadChunk 上传，成功后标记完成。允许重试，但不允许最终失败；若重试耗尽仍失败，则抛出 QueueAborted 事件并中止整个上传。

当所有分片 hash 都已计算完成时，抛出 AllChunksHashed 事件；随后在 Worker 中按顺序合并分片 hash 计算文件 hash，并抛出 FileHashed 事件。监听 FileHashed 后，调用 /file/patchHash 检查文件是否已上传：

- 已上传：若并发队列仍有进行中的任务，则主动终止它们并完成上传；若队列为空则直接完成上传。
- 未上传：等待队列“全部成功完成”（QueueDrained：要求 allChunksHashed、pending===0、inFlight===0、failed===0 且 completed===totalChunks），再调用 /file/merge 进行合并，合并成功后完成上传。

注意：不允许在存在失败（failed>0）的情况下触发 QueueDrained 或 /file/merge；出现不可恢复失败时触发 QueueAborted 并终止流程。

### 流程图（Mermaid）

```mermaid
flowchart TD
  A[开始 / 选择文件] --> C0[/创建会话 /file/create/]
  C0 --> B[切片]

  subgraph WORKER[Worker]
    direction TB
    W1[计算分片 Hash（逐个）] -->|事件: ChunkHashed| Q[并发队列（限流N）]
    W1 -->|事件: AllChunksHashed| W2[按顺序合并分片 Hash 计算文件 Hash]
    W2 -->|事件: FileHashed| F2[/检查文件 /file/patchHash/]
  end

  B --> W1

  subgraph QUEUE[分片任务处理]
    direction TB
    Q --> C2[/检查分片 /file/patchHash/]
    C2 -->|已存在| C4[跳过上传，标记完成]
    C2 -->|不存在| C3[/上传分片 /file/uploadChunk/]
    C3 --> C4
    C4 --> Q
    C3 -. 重试耗尽失败 .-> QA[触发 QueueAborted]
    Q -. 事件: QueueDrained .-> E[队列完成事件]
  end

  QA -. 事件: QueueAborted .-> ABORT[终止上传（失败）]

  F2 -->|已存在| F3{并发队列是否仍有任务?}
  F3 -->|是| FC[终止剩余队列并完成上传]
  F3 -->|否| FC
  FC -. 事件: QueueCancelled .-> EC[队列取消事件]

  F2 -->|不存在| F4{并发队列是否全部完成?}
  F4 -->|否| F5[等待队列完成] -. 事件: QueueDrained .-> FR[/合并前复检 /file/patchHash/]
  F4 -->|是| FR[/合并前复检 /file/patchHash/]
  FR -->|已上传| FC
  FR -->|未上传| F7[/合并分片 /file/merge/]
  FR -->|检查失败(重试穷尽)| QA
  F7 --> F6[上传完成]
```

## 事件与状态定义

事件

- ChunkHashed ：单个分片 Hash 完成，产生一个队列任务。
- AllChunksHashed ：所有分片 Hash 已产生，不再新增任务。
- FileHashed ：文件 Hash 完成。
- QueueDrained ：并发队列全部成功完成（无任何失败）。
- QueueAborted ：出现不可恢复失败，队列被中止（失败路径）。
- QueueCancelled ：文件已存在等正常提前结束时，主动取消剩余队列（成功路径）。

计数

- totalChunks ：总分片数。
- pending ：待调度任务数。
- inFlight ：执行中的任务数。
- completed ：成功任务数（含“已存在跳过”的成功路径）。
- failed ：失败任务数（仅用于报警/中止，不参与“完成”状态）。

队列全部处理完成的判定条件

- allChunksHashed === true （已经确定不会再新增任务）
- pending === 0 （无待开始任务）
- inFlight === 0 （无执行中的任务）
- failed === 0 （没有任何失败）
- completed === totalChunks （全部任务均成功）

满足上述条件才触发 QueueDrained 。否则：

- 一旦 failed > 0 ，立即触发 QueueAborted 并中止后续流程（见下文“失败处理”）。

全局守卫与一次性事件

- 全局状态：aborted（失败中止）、cancelled（正常取消）。所有监听器在执行前必须检查守卫：若已 aborted/cancelled 直接返回。
- 一次性事件：QueueDrained、QueueAborted、QueueCancelled 互斥且仅能发布一次（one-shot）。QueueDrained 既是事件也是“已完成”状态（sticky）：若在监听建立前已经发生，后续观察者应通过状态检查立即前进，无需再阻塞等待事件。
- 优先级：Aborted > Cancelled > Drained。当多个终止信号并发到达时，按此优先级决策并仅发布一个。进入 Aborted/Cancelled 后，后续一切回调（含 in-flight 的失败返回）与计数更新一律忽略（幂等短路）。
- 时序约束：AllChunksHashed 必须在最后一个 ChunkHashed 发布之后，且“最后一个分片对应的队列任务已入队（pending++）”后再发布，避免因短暂空窗（pending/inFlight 均为 0）误判 QueueDrained。

触发合并的条件（文件未上传）

- FileHashed 后，调用 /file/patchHash 判断文件是否已上传：
 - 已上传：若 inFlight > 0 ，终止并发队列；否则直接完成上传。
  - 未上传：若此时已满足 QueueDrained 条件则无需等待事件，直接进入“合并前复检”；否则等待 QueueDrained，然后在合并前再次调用 /file/patchHash 进行“合并前复检”；若此时已上传则直接完成；否则再触发 /file/merge 。
  - 合并前复检若连续失败（重试穷尽），立即触发 QueueAborted；不进行合并。
- 注意：不再允许 failed > 0 的情况下触发合并。
- 若文件 Hash 计算失败或被中断（例如 Worker 错误或文件读取失败），立即触发 QueueAborted 并终止流程。

合并幂等与冲突处理

- 若 /file/merge 返回“已合并/已存在”（例如 409/412 等），视为幂等成功，直接进入“上传完成”。
- 并发会话合并：两个会话几乎同时发起合并时，先完成者返回 200；后到者可返回 409/412，但均视为幂等成功并返回相同 `url`。
- 合并前复检与合并请求之间可能存在竞态；客户端应容忍在合并调用处收到“幂等成功”的响应。

失败处理（不允许失败）

- 单任务失败时：
  - 若支持重试：对该任务进行重试（建议指数退避 + 抖动）。
  - 当重试耗尽仍失败：设置 failed++ ，立即中止队列并发出 QueueAborted ，取消一切未开始和进行中的任务，标记上传失败。
- 不将“失败”视为“完成”的一部分；失败不会触发 QueueDrained 。
- 任一分片 Hash 或文件 Hash 计算失败/中断，视为不可恢复失败，直接触发 QueueAborted；不进行重试。

重试策略（建议）

- 分片级：/file/patchHash 与 /file/uploadChunk 失败采用指数退避重试（如最多 3 次，基于 200ms、400ms、800ms + 抖动）。
- 文件级：/file/patchHash 与 /file/merge 失败同样采用幂等重试策略（如最多 3-5 次）。
- 重试耗尽：分片级触发 QueueAborted 全局中止；文件级在合并阶段重试耗尽也视为失败中止。

终止与完成的时机

- 对外宣告“完成”的定义：
  - 取消路径（文件已存在）：队列统一取消后，等待 inFlight===0 且取消状态生效，再对外宣告完成；并发布 QueueCancelled（一次性）。
  - 合并路径（文件未存在）：/file/merge 成功或幂等成功并获得 url，即视为完成。
- 失败中止路径：触发 QueueAborted 后立即中止队列，拒绝一切后续事件的处理（受全局守卫保护）。
- 进入 Aborted/Cancelled/完成清理后到达的任何回调（含 2xx/4xx/5xx/网络错误/`Invalid token` 等）一律忽略，不计入 failed，也不改变状态。

## 会话过期与恢复

- `token` 默认有效期 1 小时。上传过程中若任一接口返回 `{ status: 'error', message: 'Invalid token' }` 或 401/403（且当前并非取消/完成清理态），视为不可恢复失败。
- 客户端应立即触发 QueueAborted，取消全部未开始与进行中的分片任务；不进行续期或会话重建（若需续期属于未来扩展，不在本文档范围内）。
- 取消/完成清理后到达的任何响应（含 `Invalid token`/4xx/5xx/网络错误）均应被忽略，不计入失败。

边界情况

- 禁止零分片：chunksLength 必须 ≥ 1。若检测到 0 分片，直接拒绝创建会话或立即中止流程（QueueAborted）。
- 空文件：当 `size=0` 时，`chunksLength` 必须为 1（单空分片）。该单空分片允许 `size=0`，不适用“最后一个分片长度必须 >0”的一般约束。

## 分片和文件 hash 计算

依赖于：Spark-MD5.js

分片 hash 与文件 hash 算法与规范：

- 分片 hash：对每个分片二进制数据计算 MD5（SparkMD5.ArrayBuffer）。输出为小写十六进制字符串。
- 文件 hash（推荐）：将所有分片 hash 按分片顺序简单拼接成字符串 S，然后计算 MD5(S) 作为 fileHash。客户端与服务端必须严格一致（小写十六进制、无分隔符，或使用固定分隔符需一致）。
- 分片大小：使用固定 chunkSize（最后一个分片可小于 chunkSize）。chunkSize 需在客户端与服务端保持一致，以保证“秒传”一致性。
  - 特例：当文件 `size=0` 且 `chunksLength=1` 时，允许最后一个分片 `size=0`（单空分片）。
- 合并后校验：/file/merge 返回服务端计算的最终 fileHash，客户端应对比本地 fileHash，一致才视为成功；不一致应视为失败并根据策略重试或中止。
- Hash 计算失败/中断策略：任一分片或文件 Hash 计算失败/中断，直接触发 QueueAborted，不进行重试。

## API 契约

基础信息

- 基础路径：`/file`
- 认证：通过 `POST /file/create` 获取 `token`，其后在分片校验、上传、合并均需携带 `token`。`token` 为服务端签发的 JWT，默认有效期 1 小时。

接口列表

- POST `/file/create`
  - 用途：创建文件上传会话并返回 `token`。
  - Content-Type：`application/json`
  - 请求体：
    - `name: string` 文件名
    - `size: number` 文件大小（字节）
    - `type: string` MIME 类型
    - `chunksLength: number` 分片总数（≥1）
    - `hash?: string` 可选，文件哈希
  - 成功响应：`200` `{ status: 'ok', token: string }`
  - 失败：抛出 5xx 异常（Nest 标准错误响应）
  - 说明：`hash` 为可选，仅用于服务端记录或一致性校验，不用于提前判断“文件已存在”。

- POST `/file/patchHash`
  - 用途：哈希校验（分片/文件），并在分片已存在时建立“token-分片哈希”关联（幂等）。
  - Content-Type：`application/json`
  - 请求体：
    - `token: string`
    - `hash: string` 当 `type='chunk'` 时为分片哈希；当 `type='file'` 时为文件哈希
    - `type: 'chunk' | 'file'`
    - `index: string` 当 `type='chunk'` 时必填（用于建立 `token-index-hash` 关联）；当 `type='file'` 时不得提供
  - 成功响应：`200`
    - `type='chunk'` → `{ status: 'ok', hasChunk: boolean }`
      - 当 `hasChunk=true` 时，服务端以幂等方式建立当前 `token` 与该分片哈希的关联（若已存在则跳过），用于后续合并的完整性判定。
    - `type='file'` → `{ status: 'ok', hasFile: boolean, url?: string }`
      - 当 `hasFile=true` 时，服务端将当前会话置为取消/完成清理态，并返回可下载 `url`（`url` 必填）；客户端需取消并忽略随后到达的回调错误。
  - 失败响应：`200` `{ status: 'error', message: 'Invalid token' | 'Invalid type' | 'Hash check failed' | 'Chunk index-hash mismatch' }`
  - 说明：服务端会先校验 `token` 有效性；此接口为幂等写/读操作（当 `type='chunk'` 且已存在时会建立关联，其余为只读）。
  - 参数校验与约束：
    - `hash` 必须为 32 位小写十六进制 MD5；格式错误返回 `{ status: 'error', message: 'Hash check failed' }`
    - `index` 需为十进制字符串且满足 `0 <= index < chunksLength`；越界或非数字返回 `{ status: 'error', message: 'Invalid index' }`
    - 同一 `token` 下同一 `index` 若已绑定其他 `hash`，返回 `{ status: 'error', message: 'Chunk index-hash mismatch' }`
  - 并发与幂等：
    - 多次对同一 `(token, index, hash)` 调用为幂等；服务端返回相同结果且不重复写入
    - 对同一 `(token, index)` 提交不同 `hash` 视为冲突，不可重试错误（应触发失败路径）
    - 文件已存在（`type='file'` 且 `hasFile=true`）后，客户端对未完成的分片请求应中止；若仍有到达的 `Invalid token/4xx`，应忽略不计入失败
  - 重试建议：
    - 可重试：网络错误、`5xx`、瞬时 `429`（指数退避：200ms/400ms/800ms + 抖动）
    - 不可重试：`Invalid type`、`Invalid index`、`Chunk index-hash mismatch`、取消/完成后的 `Invalid token`
  - 示例：
    - 分片存在（跳过上传并建立关联）
      请求：
      ```json
      { "token": "<jwt>", "type": "chunk", "index": "5", "hash": "a3b1...9c0f" }
      ```
      响应：
      ```json
      { "status": "ok", "hasChunk": true }
      ```
    - 文件已存在（提前完成并取消队列）
      请求：
      ```json
      { "token": "<jwt>", "type": "file", "hash": "deadbeef..." }
      ```
      响应：
      ```json
      { "status": "ok", "hasFile": true, "url": "/file/xxx_yourhash16.ext" }
      ```

- POST `/file/uploadChunk`
  - 用途：上传单个分片
  - Content-Type：`multipart/form-data`
  - 表单字段：
    - `blob: File` 分片二进制
    - 其余字段走表单键值（与 DTO）：
      - `token: string`
      - `hash: string` 分片哈希
      - `index: string` 分片索引（字符串形式）
      - `start?: string` 可选，分片起始
      - `end?: string` 可选，分片结束
  - 成功响应：`200` `{ status: 'ok' }`
  - 失败响应：
    - `400` `{ status: 'error', message: 'No file data provided' }`
    - `400` `{ status: 'error', message: 'ChunkSizeMismatch' }`
    - `409` `{ status: 'error', message: 'Chunk index-hash mismatch' }`
    - `500` `{ status: 'error', message: 'Chunk upload failed' }`
  - 幂等性：
    - 分片数据层面：同哈希的分片已存在则跳过保存；
    - 文件关联层面：同 `token` + 分片哈希 + `index` 幂等；同一 `index` 在同一 `token` 下只能对应一个 `hash`。
  - 校验与大小：除最后一个分片外，每个分片字节长度必须等于约定的 `chunkSize`；最后一个分片长度应满足 `0 < size ≤ chunkSize`。当提交 `start/end` 时，需保证 `end - start === size`。当文件 `size=0` 且 `chunksLength=1` 时，允许最后一个分片 `size=0`（单空分片特例）。

- POST `/file/merge`
  - 用途：合并文件（或完成索引修复）并返回下载 `url`
  - Content-Type：`application/json`
  - 请求体：
    - `token: string`
    - `hash: string` 文件哈希
  - 成功响应：`200`
    - 完整：`{ status: 'ok', url: string }`
    - 检测到缺失索引并修补记录后完成：`{ status: 'ok', url: string, message: 'Completed with missing chunks added' }`
    - 幂等成功：当检测到“已合并/已存在”时视为成功，返回同一 `url` 或携带相应提示。部分实现可能以 `409/412` 表达该幂等成功，客户端必须将 `409/412` 视为成功并读取返回的 `url`。
  - 失败响应：`200` `{ status: 'error', url: '', message: 'File merge failed' }`
  - 说明：
    - 合并前服务端会用 `token` 更新文件的 `fileHash`；
    - 完整性判定基于已记录的分片索引集合与 `chunksLength` 严格一致（数量与索引覆盖均满足）。
    - 若完整则生成下载 `url`（在原文件名末尾追加 `_` + 前 16 位哈希，再接扩展名）。
    - “索引修复”仅用于服务器已掌握 `index→hash` 但记录缺失的情况进行补写，不放宽对分片完整性的判定。

- GET `/file/:url`
  - 用途：下载文件，支持 `Range` 断点续传
  - 路径参数：`url` 为上一步合并后生成的文件 `url`（注意服务端会进行 `encodeURIComponent`/`decodeURIComponent` 处理）
  - 请求头（可选）：`Range: bytes=start-end`
  - 成功响应：
    - 全量：`200` 二进制流
    - 范围：`206` 二进制流，并返回 `Content-Range`/`Content-Length`/`Accept-Ranges`
    - 通用下载头：`Content-Disposition: attachment; filename*=UTF-8''<url-encoded>`；`Content-Type: application/octet-stream`
  - 失败响应：
    - `404` `{ msg: '服务器没有该文件' }`
    - `416` `{ msg: 'Range Not Satisfiable' }`

字段与约束（来自 DTO）

- CreateFileDto
  - `name: string` 非空
  - `size: number` ≥ 0
  - `type: string` 非空
  - `chunksLength: number` 整数，≥ 1（禁止零分片）
  - `hash?: string`
- PatchHashDto
  - `token: string` 非空
  - `hash: string` 非空（32 位小写十六进制 MD5）
  - `type: 'chunk' | 'file'`
  - `index?: string` 当 `type='chunk'` 时必填；当 `type='file'` 时不得提供
- UploadChunkDto（随表单一并提交）
  - `token: string`
  - `hash: string`
  - `index: string` 非空（字符串）
  - `start?: string`，`end?: string`（可选）
- MergeFileDto
  - `token: string` 非空
  - `hash: string` 非空

返回值与状态码说明

- 大多数接口在业务失败时返回 `{ status: 'error', message: string }`，HTTP 状态常为 `200/400/500`（以控制器实现为准）。
- `download` 接口在未找到文件时返回 `404`；非法或越界的 Range 返回 `416`。
- `patchHash(type=file)` 返回 `hasFile=true` 时，服务端会将当前会话置为取消/完成清理态并返回 `url`；客户端需取消并忽略随后回调错误，不计入失败。
- 统一约定：`/file/patchHash` 与 `/file/merge` 的业务失败使用 `200` + `{ status: 'error' }`；参数/权限错误可返回 `400/401/403`；`/file/uploadChunk` 的参数错误用 `400/409`、系统错误用 `500`。客户端仅对“网络错误/5xx/瞬时 429”按重试策略进行重试。针对 `/file/merge`，当服务端以 `409/412` 表达“已合并/已存在”时，属于幂等成功语义，客户端应视为成功并读取 `url`。

幂等与副作用（与实现一致）

 - `/file/patchHash`：幂等写/读操作（`type='chunk'` 且已存在时建立 token-分片哈希 关联，其余为只读）。
 - `/file/uploadChunk`：按分片哈希与（token, index）关联去重，重复上传与重复关联不会产生重复数据。
- `/file/merge`：多次调用按实现一般可重复执行（若已设置 `url` 则返回同一 `url`）；建议客户端在合并前做一次“合并前复检”。
 - 允许相同 `hash` 在同一会话绑定多个不同 `index`；合并完整性仅以索引覆盖与数量为准。
