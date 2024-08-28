import { EventEmitter } from './EventEmitter'

// 任务构造器
export class Task<T = any> {
  constructor(
    public fn: (...args: any[]) => Promise<T> | T,
    public priority: number = 0,
    public payload?: any
  ) {}

  run(): Promise<T> {
    return Promise.resolve(this.fn(this.payload))
  }
}

// 可并发执行的任务队列
export class TaskQueue extends EventEmitter<
  'start' | 'pause' | 'drain' | 'error' | 'taskComplete'
> {
  private tasks: Task[] = []
  private currentCount = 0
  private status: 'paused' | 'running' = 'paused'

  constructor(private concurrency: number = 4) {
    super()
  }

  add(...tasks: Task[]) {
    this.tasks.push(...tasks)
    this.tasks.sort((a, b) => b.priority - a.priority)
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

  private async runNext() {
    while (
      this.status === 'running' &&
      this.currentCount < this.concurrency &&
      this.tasks.length > 0
    ) {
      const task = this.tasks.shift()!
      this.currentCount++
      try {
        const result = await task.run()
        this.emit('taskComplete', result, task)
      } catch (error) {
        this.emit('error', error, task)
      } finally {
        this.currentCount--
        if (this.tasks.length === 0 && this.currentCount === 0) {
          this.status = 'paused'
          this.emit('drain')
        }
      }
    }
  }

  cancelTask(taskToCancel: Task) {
    const index = this.tasks.indexOf(taskToCancel)
    if (index !== -1) {
      this.tasks.splice(index, 1)
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
