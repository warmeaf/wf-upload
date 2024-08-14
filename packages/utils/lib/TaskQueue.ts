import { EventEmitter } from './EventEmitter'

// 任务构造器
export class Task {
  fn: Function // 任务关联的执行函数
  payload?: any // 任务关联的其他信息
  constructor(fn: Function, payload?: any) {
    this.fn = fn
    this.payload = payload
  }

  // 执行任务
  run() {
    return this.fn(this.payload)
  }
}

// 主要改进：
// 使用数组替代 Set，保证任务执行顺序。
// 在 add 方法中，如果队列正在运行，立即尝试执行新任务。
// 改进 runNext 方法，使用 while 循环确保最大程度利用并发。
// 添加错误处理，并发出 'error' 事件。
// 添加 clear 方法用于清空队列。
// 添加 size 和 isRunning getter 方法，方便外部获取队列状态。

// 可并发执行的任务队列
export class TaskQueue extends EventEmitter<
  'start' | 'pause' | 'drain' | 'error'
> {
  private tasks: Task[] = []
  private currentCount = 0
  private status: 'paused' | 'running' = 'paused'
  private concurrency: number = 4

  constructor(concurrency: number = 4) {
    super()
    this.concurrency = concurrency
  }

  add(...tasks: Task[]) {
    this.tasks.push(...tasks)
    if (this.status === 'running') {
      this.runNext()
    }
  }

  addAndStart(...tasks: Task[]) {
    this.add(...tasks)
    this.start()
  }

  start() {
    if (this.status === 'running') return
    this.status = 'running'
    this.emit('start')
    this.runNext()
  }

  private runNext() {
    while (
      this.status === 'running' &&
      this.currentCount < this.concurrency &&
      this.tasks.length > 0
    ) {
      const task = this.tasks.shift()!
      this.currentCount++
      Promise.resolve(task.run())
        .catch((error) => {
          this.emit('error', error, task)
        })
        .finally(() => {
          this.currentCount--
          this.runNext()
        })
    }

    if (this.tasks.length === 0 && this.currentCount === 0) {
      this.status = 'paused'
      this.emit('drain')
    }
  }

  pause() {
    this.status = 'paused'
    this.emit('pause')
  }

  clear() {
    this.tasks = []
  }

  get size() {
    return this.tasks.length
  }

  get isRunning() {
    return this.status === 'running'
  }
}
