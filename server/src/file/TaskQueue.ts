export class TaskQueue {
  private tasks: (() => Promise<void>)[] = [];
  private running = 0;

  constructor(private readonly concurrency: number) {}

  add(task: () => Promise<void>) {
    this.tasks.push(task);
    this.runNext();
  }

  private runNext() {
    if (this.running >= this.concurrency || this.tasks.length === 0) {
      return;
    }

    const task = this.tasks.shift()!;
    this.running++;

    task().finally(() => {
      this.running--;
      this.runNext();
    });
  }

  on(event: 'drain', callback: () => void) {
    const checkDrain = () => {
      if (this.running === 0 && this.tasks.length === 0) {
        callback();
      } else {
        setTimeout(checkDrain, 50);
      }
    };

    checkDrain();
  }
}
