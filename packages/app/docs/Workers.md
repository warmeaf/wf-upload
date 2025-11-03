# 分片Hash计算多线程优化技术方案

## 1. 背景与目标

### 1.1 当前实现

- **现状**：使用单个Worker线程串行计算所有分片的Hash
- **问题**：大文件分片数量多时，Hash计算成为性能瓶颈，串行计算耗时较长
- **影响**：延长了整体上传时间，无法充分利用多核CPU资源

### 1.2 优化目标

- **并行计算**：利用多Worker线程并行计算分片Hash，提升计算效率
- **系统自适应**：线程数由系统硬件并发能力决定（`navigator.hardwareConcurrency`）
- **可配置性**：提供配置项控制是否启用多线程计算，默认启用（`enableMultiThreading: true`）
- **向后兼容**：保持现有事件机制和API接口不变
- **错误处理**：保持现有错误处理策略，确保系统稳定性

## 2. 架构设计

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────┐
│                    WorkerManager                        │
│  ┌──────────────────────────────────────────────────┐  │
│  │            WorkerPool (线程池)                    │  │
│  │  ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐         │  │
│  │  │Worker│  │Worker│  │Worker│  │Worker│  ...    │  │
│  │  │  1   │  │  2   │  │  3   │  │  N   │         │  │
│  │  └──────┘  └──────┘  └──────┘  └──────┘         │  │
│  └──────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────┐  │
│  │        TaskQueue (任务队列)                       │  │
│  │  [chunk0] [chunk1] [chunk2] ... [chunkN]        │  │
│  └──────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────┐  │
│  │     ResultBuffer (结果缓冲与排序)                 │  │
│  │  保证ChunkHashed事件按索引顺序触发                │  │
│  └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### 2.2 核心组件

#### 2.2.1 WorkerPool（Worker线程池）

- **职责**：管理多个Worker实例的生命周期
- **线程数**：使用 `navigator.hardwareConcurrency || 4` 作为默认值
- **特性**：
  - 创建固定数量的Worker实例（线程池大小）
  - 复用Worker实例，避免频繁创建销毁
  - 统一管理Worker的错误处理和资源清理

#### 2.2.2 TaskQueue（任务队列）

- **职责**：将分片任务分配给空闲的Worker
- **策略**：
  - 使用队列存储待处理的分片任务
  - 当Worker空闲时，从队列取出任务分配给Worker
  - 实现负载均衡，确保各Worker工作量均衡

#### 2.2.3 ResultBuffer（结果缓冲区）

- **职责**：缓冲并行计算的结果，保证事件按顺序触发
- **问题**：并行计算时，结果可能乱序到达（例如chunk5先于chunk2完成）
- **解决方案**：
  - 使用Map或数组存储已完成的chunk结果（key为chunk.index）
  - 维护一个`nextExpectedIndex`，表示下一个应该输出的chunk索引
  - 当收到结果时，检查是否可以连续输出（从`nextExpectedIndex`开始）
  - 只有当连续的分片都完成时，才按顺序触发`ChunkHashed`事件

#### 2.2.4 FileHashCalculator（文件Hash计算器）

- **职责**：在所有分片Hash计算完成后，计算文件Hash
- **时机**：所有分片Hash计算完成且已按顺序输出后
- **计算方式**：按索引顺序增量计算（与现有逻辑保持一致）

## 3. 详细设计

### 3.1 配置项说明

#### 3.1.1 多线程配置

```typescript
interface UploadConfig {
  chunkSize: number
  concurrency: number
  baseUrl: string
  enableMultiThreading?: boolean // 新增配置项，默认 true
}
```

**配置说明**：

- **`enableMultiThreading`**：布尔值，控制是否启用多线程Hash计算
  - `true`（默认）：启用多线程计算，使用Worker线程池并行处理
  - `false`：禁用多线程，回退到单Worker串行计算（与现有实现一致）
- **使用场景**：
  - 性能优先场景：默认启用多线程（`true`）
  - 资源受限场景：禁用多线程（`false`），减少资源消耗
  - 调试场景：禁用多线程便于调试和问题排查

#### 3.1.2 Worker线程数确定

```typescript
// 线程数计算策略
const getOptimalWorkerCount = (enableMultiThreading: boolean): number => {
  // 如果禁用多线程，返回1（单Worker模式）
  if (!enableMultiThreading) {
    return 1
  }

  // 优先使用系统硬件并发数
  const hardwareConcurrency = navigator.hardwareConcurrency || 4

  // 限制最大线程数，避免过度消耗资源
  const MAX_WORKERS = 8
  const MIN_WORKERS = 1

  return Math.max(MIN_WORKERS, Math.min(MAX_WORKERS, hardwareConcurrency))
}
```

**考虑因素**：

- **配置项优先**：如果`enableMultiThreading`为`false`，直接返回1（单Worker）
- `navigator.hardwareConcurrency`：浏览器提供的CPU核心数（可能为undefined）
- 最小线程数：1（兼容单核设备）
- 最大线程数：8（避免过多线程导致上下文切换开销）
- 默认值：4（当无法获取硬件信息时）

### 3.2 Worker消息协议扩展

#### 3.2.1 Worker任务消息（主线程 → Worker）

```typescript
interface WorkerTaskMessage {
  type: 'task'
  taskId: string // 任务唯一标识
  chunkIndex: number // 分片索引
  blob: Blob // 分片数据
}
```

#### 3.2.2 Worker结果消息（Worker → 主线程）

```typescript
interface WorkerResultMessage {
  type: 'result'
  taskId: string // 任务唯一标识
  chunkIndex: number // 分片索引
  hash: string // 分片Hash
}

interface WorkerErrorMessage {
  type: 'error'
  taskId?: string // 可选的失败任务ID
  error: string // 错误信息
}
```

**设计说明**：

- 每个任务分配唯一`taskId`，用于追踪任务状态
- `chunkIndex`确保结果能正确映射到分片
- 保持与现有`WorkerMessage`类型的兼容性

### 3.3 任务分配策略

#### 3.3.1 分配算法

```
算法：工作窃取（Work Stealing）的简化版本

1. 初始化阶段：
   - 创建WorkerPool，初始化N个Worker
   - 创建TaskQueue，将所有chunk任务入队
   - 创建ResultBuffer，初始化状态

2. 执行阶段：
   - 每个Worker维护一个"空闲"状态
   - 当Worker空闲时，从TaskQueue取出下一个任务
   - 如果TaskQueue为空，Worker进入等待状态
   - Worker完成任务后，将结果发送给ResultBuffer
   - ResultBuffer检查是否可以按顺序输出结果

3. 完成判定：
   - 所有chunk任务已分配（TaskQueue为空）
   - 所有Worker空闲（无正在执行的任务）
   - ResultBuffer已输出所有结果
```

#### 3.3.2 负载均衡

- **策略**：采用FIFO队列，确保任务分配均匀
- **优势**：简单高效，无需复杂的负载统计
- **考虑**：对于分片大小差异较大的情况，可以考虑按分片大小分配，但会增加复杂度

### 3.4 结果排序与输出

#### 3.4.1 缓冲算法

```typescript
class ResultBuffer {
  private results: Map<number, ChunkResult> = new Map()
  private nextExpectedIndex: number = 0
  private totalChunks: number

  // 添加结果
  addResult(chunkIndex: number, hash: string, chunk: ChunkInfo): void {
    this.results.set(chunkIndex, { hash, chunk })
    this.tryFlushResults()
  }

  // 尝试按顺序输出结果
  private tryFlushResults(): void {
    while (this.results.has(this.nextExpectedIndex)) {
      const result = this.results.get(this.nextExpectedIndex)!
      this.emitChunkHashed(result.chunk, result.hash)
      this.results.delete(this.nextExpectedIndex)
      this.nextExpectedIndex++

      // 检查是否全部完成
      if (this.nextExpectedIndex >= this.totalChunks) {
        this.emitAllChunksHashed()
      }
    }
  }
}
```

#### 3.4.2 顺序保证

- **要求**：`ChunkHashed`事件必须按`chunk.index`从0开始依次触发
- **原因**：上传队列依赖分片顺序，主线程可能依赖顺序处理
- **实现**：使用缓冲机制，只有连续的分片完成时才输出

### 3.5 文件Hash计算

#### 3.5.1 计算时机

- **触发条件**：`AllChunksHashed`事件触发后
- **计算位置**：主线程（WorkerManager）
- **原因**：需要在主线程中按顺序收集所有分片Hash

#### 3.5.2 计算流程

```typescript
// 在ResultBuffer中，当所有分片完成时
private calculateFileHash(): string {
  const chunkHashes: string[] = []

  // 按索引顺序收集Hash（已经按顺序存储）
  for (let i = 0; i < this.totalChunks; i++) {
    chunkHashes.push(this.chunkHashes[i])
  }

  // 使用SparkMD5增量计算
  const spark = new SparkMD5()
  for (const hash of chunkHashes) {
    spark.append(hash)
  }

  return spark.end().toLowerCase()
}
```

## 4. 实现细节

### 4.1 WorkerManager重构

#### 4.1.1 新增属性

```typescript
class WorkerManager {
  private workerPool: WorkerPool | null = null // Worker线程池（多线程模式）
  private worker: Worker | null = null // 单Worker（单线程模式）
  private taskQueue: TaskQueue | null = null // 任务队列（多线程模式）
  private resultBuffer: ResultBuffer | null = null // 结果缓冲区（多线程模式）
  private workerCount: number = 1 // Worker数量
  private isProcessing: boolean = false // 是否正在处理
  private enableMultiThreading: boolean = true // 是否启用多线程（默认true）
}
```

#### 4.1.2 构造函数修改

```typescript
constructor(enableMultiThreading: boolean = true) {
  this.enableMultiThreading = enableMultiThreading
}
```

#### 4.1.3 核心方法修改

```typescript
async startHashing(file: File, chunkSize: number): Promise<void> {
  // 1. 创建分片
  const chunks = this.createChunks(file, chunkSize)

  // 2. 根据配置选择处理模式
  if (this.enableMultiThreading) {
    await this.startMultiThreading(chunks)
  } else {
    await this.startSingleThreading(file, chunkSize)
  }
}

// 多线程模式
private async startMultiThreading(chunks: ChunkInfo[]): Promise<void> {
  // 1. 初始化WorkerPool（根据系统决定线程数）
  this.workerCount = this.getOptimalWorkerCount(this.enableMultiThreading)
  this.workerPool = new WorkerPool(this.workerCount)

  // 2. 初始化任务队列和结果缓冲区
  this.taskQueue = new TaskQueue(chunks)
  this.resultBuffer = new ResultBuffer(chunks.length, this)

  // 3. 启动Worker处理任务
  this.workerPool.start(this.taskQueue, this.resultBuffer)

  // 4. 等待所有任务完成
  await this.workerPool.waitForCompletion()
}

// 单线程模式（回退到现有实现）
private async startSingleThreading(file: File, chunkSize: number): Promise<void> {
  // 使用单个Worker，复用现有的hash-worker.ts逻辑
  this.worker = this.createWorker()

  this.worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
    this.handleWorkerMessage(e.data)
  }

  this.worker.onerror = (error) => {
    const abortEvent: QueueAbortedEvent = {
      type: 'QueueAborted',
      error: new Error(`Worker error: ${error.message}`),
    }
    this.emit(abortEvent)
  }

  // 发送开始消息（使用现有的WorkerStartMessage格式）
  const startMessage: WorkerStartMessage = {
    type: 'start',
    file,
    chunkSize,
  }
  this.worker.postMessage(startMessage)
}
```

**关键变化**：

- **配置驱动**：根据`enableMultiThreading`配置选择处理模式
- **多线程模式**：使用WorkerPool、TaskQueue、ResultBuffer进行并行计算
- **单线程模式**：回退到现有的单Worker实现，保持完全兼容
- **统一接口**：两种模式对外提供相同的API和事件机制

#### 4.1.4 terminate方法修改

```typescript
terminate(): void {
  // 多线程模式：终止WorkerPool
  if (this.workerPool) {
    this.workerPool.terminate()
    this.workerPool = null
  }
  
  // 单线程模式：终止单个Worker
  if (this.worker) {
    this.worker.terminate()
    this.worker = null
  }
  
  // 清理相关资源
  this.taskQueue = null
  this.resultBuffer = null
}
```

### 4.2 WorkerPool实现

```typescript
class WorkerPool {
  private workers: Worker[] = []
  private workerStates: Map<Worker, 'idle' | 'busy'> = new Map()
  private taskQueue: TaskQueue
  private resultBuffer: ResultBuffer

  constructor(workerCount: number) {
    // 创建Worker实例
    for (let i = 0; i < workerCount; i++) {
      const worker = this.createWorker()
      this.workers.push(worker)
      this.workerStates.set(worker, 'idle')
      this.setupWorkerHandlers(worker)
    }
  }

  start(taskQueue: TaskQueue, resultBuffer: ResultBuffer): void {
    this.taskQueue = taskQueue
    this.resultBuffer = resultBuffer

    // 启动所有Worker开始处理任务
    this.workers.forEach((worker) => {
      this.assignNextTask(worker)
    })
  }

  private assignNextTask(worker: Worker): void {
    const task = this.taskQueue.dequeue()

    if (!task) {
      // 队列为空，Worker进入空闲状态
      this.workerStates.set(worker, 'idle')
      return
    }

    this.workerStates.set(worker, 'busy')

    // 发送任务给Worker
    worker.postMessage({
      type: 'task',
      taskId: task.taskId,
      chunkIndex: task.chunk.index,
      blob: task.chunk.blob,
    })
  }

  private handleWorkerResult(
    worker: Worker,
    message: WorkerResultMessage
  ): void {
    // 将结果传递给ResultBuffer
    this.resultBuffer.addResult(
      message.chunkIndex,
      message.hash,
      this.taskQueue.getChunkByIndex(message.chunkIndex)
    )

    // Worker完成任务，继续分配下一个任务
    this.assignNextTask(worker)
  }
}
```

### 4.3 hash-worker.ts修改

#### 4.3.1 消息处理

```typescript
// 修改Worker的消息处理逻辑
self.onmessage = (e: MessageEvent<WorkerTaskMessage>) => {
  const { type, taskId, chunkIndex, blob } = e.data

  if (type === 'task') {
    this.processChunk(taskId, chunkIndex, blob)
  }
}

async function processChunk(
  taskId: string,
  chunkIndex: number,
  blob: Blob
): Promise<void> {
  try {
    const hash = await calculateChunkHash(blob)

    // 发送结果回主线程
    self.postMessage({
      type: 'result',
      taskId,
      chunkIndex,
      hash,
    })
  } catch (error) {
    self.postMessage({
      type: 'error',
      taskId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
```

**关键变化**：

- Worker不再处理整个文件，只处理单个分片
- 移除文件Hash计算逻辑（移至主线程）
- 简化Worker职责，专注于分片Hash计算

### 4.4 错误处理

#### 4.4.1 Worker错误处理

```typescript
private handleWorkerError(worker: Worker, error: Error): void {
  // 1. 终止所有Worker
  this.terminateAllWorkers()

  // 2. 清空任务队列
  this.taskQueue.clear()

  // 3. 清空结果缓冲区
  this.resultBuffer.clear()

  // 4. 触发QueueAborted事件
  const abortEvent: QueueAbortedEvent = {
    type: 'QueueAborted',
    error: new Error(`Worker error: ${error.message}`),
  }
  this.emit(abortEvent)
}
```

#### 4.4.2 任务失败处理

- **单个任务失败**：立即终止所有Worker和任务处理
- **错误传播**：通过`QueueAborted`事件通知上层
- **资源清理**：确保所有Worker被正确终止

## 5. 性能优化

### 5.1 预期性能提升

- **理论加速比**：接近线程数（N倍，N为Worker数量）
- **实际加速比**：受以下因素影响：
  - CPU核心数
  - 分片大小（影响I/O开销）
  - 内存带宽
  - 上下文切换开销

### 5.2 优化建议

#### 5.2.1 动态线程数调整

```typescript
// 根据文件大小和分片数量动态调整线程数
const getDynamicWorkerCount = (fileSize: number, chunkSize: number): number => {
  const totalChunks = Math.ceil(fileSize / chunkSize)
  const baseWorkers = getOptimalWorkerCount()

  // 分片数量少时，减少Worker数量
  if (totalChunks < baseWorkers) {
    return Math.max(1, totalChunks)
  }

  return baseWorkers
}
```

#### 5.2.2 Worker预热

- **策略**：在首次使用时提前创建WorkerPool
- **优势**：避免首次计算时的Worker创建开销
- **实现**：延迟初始化或预加载机制

#### 5.2.3 内存优化

- **Blob传递**：使用`Transferable`对象避免数据拷贝
- **限制**：浏览器对`Transferable`的支持可能有限
- **权衡**：优先保证兼容性，再考虑性能优化

## 6. 兼容性与降级策略

### 6.1 浏览器兼容性

#### 6.1.1 Worker支持检测

```typescript
const isWorkerSupported = (): boolean => {
  return typeof Worker !== 'undefined'
}

const isHardwareConcurrencySupported = (): boolean => {
  return typeof navigator !== 'undefined' && 'hardwareConcurrency' in navigator
}
```

#### 6.1.2 降级策略

- **不支持Worker**：回退到主线程计算（性能较差，但保证功能）
- **无法获取硬件信息**：使用默认值4个Worker
- **Worker创建失败**：逐步降级Worker数量，直至单Worker

### 6.2 向后兼容

- **事件机制**：保持现有事件类型和触发时机不变
- **API接口**：`WorkerManager.startHashing()`接口保持不变
- **类型定义**：扩展类型定义，不破坏现有类型
- **配置兼容**：`enableMultiThreading`默认为`true`，无需修改现有代码即可获得性能提升
- **单线程回退**：设置`enableMultiThreading: false`时，完全回退到现有单Worker实现

### 6.3 配置项使用示例

#### 6.3.1 启用多线程（默认）

```typescript
// 方式1：使用默认值（启用多线程）
const uploader = new FileUploader({
  config: {
    chunkSize: 2 * 1024 * 1024,
    concurrency: 3,
    baseUrl: 'https://api.example.com',
    // enableMultiThreading 默认为 true，无需显式指定
    // WorkerManager会自动使用多线程模式
  },
})

// 方式2：显式启用多线程
const uploader = new FileUploader({
  config: {
    chunkSize: 2 * 1024 * 1024,
    concurrency: 3,
    baseUrl: 'https://api.example.com',
    enableMultiThreading: true, // 显式启用多线程
  },
})
```

**实现说明**：

- `FileUploader`构造函数接收`config`参数，包含`enableMultiThreading`配置项
- `FileUploader`在创建`WorkerManager`时，将`config.enableMultiThreading`传递给`WorkerManager`构造函数
- `WorkerManager`根据配置项决定使用多线程模式还是单线程模式

#### 6.3.2 禁用多线程（单线程模式）

```typescript
// 禁用多线程，使用单Worker串行计算
const uploader = new FileUploader({
  config: {
    chunkSize: 2 * 1024 * 1024,
    concurrency: 3,
    baseUrl: 'https://api.example.com',
    enableMultiThreading: false, // 禁用多线程
  },
})
```

**使用场景**：

- **禁用多线程的场景**：
  - 资源受限环境（移动设备、低配置设备）
  - 调试和问题排查（简化执行流程）
  - 内存敏感场景（减少Worker实例数量）
  - 小文件上传（多线程开销大于收益）

- **启用多线程的场景**（默认）：
  - 大文件上传（多分片，计算量大）
  - 高性能设备（多核CPU）
  - 追求最佳性能的场景

## 7. 测试策略

### 7.1 单元测试

- **WorkerPool测试**：验证Worker创建、任务分配、结果收集
- **ResultBuffer测试**：验证结果排序和顺序输出
- **错误处理测试**：验证Worker错误时的资源清理

### 7.2 性能测试

- **基准测试**：对比单线程vs多线程的性能提升
- **不同文件大小**：测试小文件、中等文件、大文件的性能
- **不同线程数**：测试不同Worker数量的性能表现

### 7.3 集成测试

- **端到端测试**：验证完整上传流程的正确性
- **并发测试**：多个文件同时上传的场景
- **错误场景**：模拟Worker失败、网络中断等异常情况

## 8. 实施计划

### 8.1 实施步骤

1. **阶段一：核心组件开发**
   - 实现`WorkerPool`类
   - 实现`TaskQueue`类
   - 实现`ResultBuffer`类

2. **阶段二：WorkerManager重构**
   - 重构`WorkerManager.startHashing()`方法
   - 集成WorkerPool、TaskQueue、ResultBuffer
   - 更新错误处理逻辑

3. **阶段三：Worker脚本修改**
   - 修改`hash-worker.ts`，支持单任务处理
   - 更新消息协议

4. **阶段四：测试与优化**
   - 编写单元测试
   - 性能测试与调优
   - 兼容性测试

5. **阶段五：文档更新**
   - 更新API文档
   - 更新使用示例
   - 更新架构文档

### 8.2 风险评估

- **风险1**：Worker数量过多导致资源消耗
  - **缓解**：限制最大Worker数量，提供配置选项`enableMultiThreading`可禁用多线程

- **风险2**：结果排序逻辑复杂，容易出现bug
  - **缓解**：编写详细的单元测试，使用类型系统保证正确性，提供单线程模式作为回退

- **风险3**：浏览器兼容性问题
  - **缓解**：提供降级策略，支持单Worker模式，可通过配置项禁用多线程

- **风险4**：配置项默认值变更影响现有用户
  - **缓解**：默认值设为`true`（启用多线程），但提供显式配置选项，用户可根据需要调整

## 9. 总结

### 9.1 核心优势

1. **性能提升**：多线程并行计算，充分利用多核CPU
2. **系统自适应**：根据硬件能力自动调整线程数
3. **可配置性**：提供`enableMultiThreading`配置项，用户可根据场景选择多线程或单线程模式
4. **向后兼容**：保持现有API和事件机制不变，默认启用多线程
5. **灵活降级**：可通过配置项回退到单线程模式，适合资源受限或调试场景
6. **错误处理**：完善的错误处理和资源清理机制

### 9.2 关键技术点

1. **Worker线程池**：复用Worker实例，提升效率
2. **任务队列**：实现负载均衡和任务调度
3. **结果缓冲**：保证事件顺序，维护系统一致性
4. **动态线程数**：根据系统能力自动调整
5. **配置驱动**：通过`enableMultiThreading`配置项控制处理模式，支持灵活切换

### 9.3 后续优化方向

1. **动态负载均衡**：根据Worker性能动态分配任务
2. **Worker预热**：提前创建Worker，减少首次计算延迟
3. **内存优化**：使用Transferable对象减少数据拷贝
4. **性能监控**：添加性能指标收集，指导进一步优化
