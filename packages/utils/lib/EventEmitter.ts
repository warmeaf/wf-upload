export class EventEmitter<T extends string> {
  private events: Map<T, Set<Function>>
  constructor() {
    this.events = new Map()
  }

  /**
   * 为指定事件添加监听器
   * @param event - 要监听的事件类型
   * @param listener - 当事件发生时要执行的函数
   */
  on(event: T, listener: Function) {
    if (!this.events.has(event)) {
      this.events.set(event, new Set())
    }
    this.events.get(event)!.add(listener)
  }

  /**
   * 移除指定事件的监听器
   * @param event - 要移除监听器的事件类型
   * @param listener - 要移除的监听器函数
   */
  off(event: T, listener: Function) {
    if (!this.events.has(event)) {
      return
    }
    this.events.get(event)!.delete(listener)
  }

  /**
   * 注册一个一次性事件监听器，在触发一次后自动移除
   * @param event - 要监听的事件类型
   * @param listener - 当事件发生时要执行的函数
   */
  once(event: T, listener: Function) {
    const onceListener = (...args: any[]) => {
      listener(...args)
      this.off(event, onceListener)
    }
    this.on(event, onceListener)
  }

  /**
   * 触发指定事件，并传递额外的参数。如果事件存在监听器，每个监听器函数都会被调用。
   * @param event - 要触发的事件类型
   * @param args - 传递给监听器函数的参数
   */
  emit(event: T, ...args: any[]) {
    if (!this.events.has(event)) {
      return
    }
    this.events.get(event)!.forEach((listener) => {
      listener(...args)
    })
  }
}
