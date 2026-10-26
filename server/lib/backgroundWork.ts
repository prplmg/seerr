import path from 'path';
import { Worker } from 'worker_threads';
import type { BackgroundResult, BackgroundTask } from './backgroundWorkTasks';

type Read = (page: number) => Promise<string>;
type Work = {
  id: number;
  task: BackgroundTask;
  read?: Read;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer?: NodeJS.Timeout;
};

/** One reusable CPU worker; at most two asynchronous collectors in flight.
 * The worker owns no database, settings, queues, or JSON state. Network reads
 * use the web process's existing authenticated/proxy-aware client; parsing and
 * collection happen here, and callers commit under their existing locks.
 * Failure is explicit: no inline fallback and no automatic replay of writes.
 */
export class BackgroundWork {
  private worker?: Worker;
  private sequence = 0;
  private queue: Work[] = [];
  private active = new Map<number, Work>();
  private idle?: NodeJS.Timeout;
  constructor(
    private timeoutMs = 120000,
    private maxQueue = 32
  ) {}

  run<T extends BackgroundTask>(
    task: T,
    read?: Read
  ): Promise<BackgroundResult<T>> {
    if (this.queue.length + this.active.size >= this.maxQueue)
      return Promise.reject(Error('Background work queue full'));
    return new Promise((resolve, reject) => {
      this.queue.push({
        id: ++this.sequence,
        task,
        read,
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      this.pump();
    });
  }

  private start() {
    const entry = path.join(
      __dirname,
      `backgroundWorkThread${path.extname(__filename)}`
    );
    const worker = new Worker(
      `
      const { workerData } = require('worker_threads');
      if (workerData.entry.endsWith('.ts')) require('ts-node').register({
        transpileOnly: true, project: workerData.project
      });
      require(workerData.entry);
    `,
      {
        eval: true,
        execArgv: [],
        resourceLimits: { maxOldGenerationSizeMb: 192 },
        workerData: {
          entry,
          project: path.join(__dirname, '../tsconfig.json'),
        },
      }
    );
    this.worker = worker;
    worker.on('message', async (message) => {
      if (this.worker !== worker) return;
      const work = this.active.get(message.id);
      if (!work) return;
      if (message.type === 'read') {
        clearTimeout(work.timer);
        // A source timeout cancels only this read-only collector. Progress resets
        // the budget: 40 valid pages need not fit into one 120-second window.
        work.timer = setTimeout(
          () => {
            if (this.worker !== worker || !this.active.has(work.id)) return;
            this.active.delete(work.id);
            worker.postMessage({ type: 'cancel', id: work.id });
            work.reject(Error('Background source timed out'));
            this.pump();
          },
          Math.min(this.timeoutMs, 15000)
        );
        try {
          if (
            !work.read ||
            !Number.isInteger(message.page) ||
            message.page < 0 ||
            message.page > 40
          )
            throw Error('Invalid background read');
          const text = await work.read(message.page);
          if (this.worker === worker && this.active.has(work.id)) {
            this.armCpu(work, worker);
            worker.postMessage({ type: 'read-result', id: work.id, text });
          }
        } catch {
          if (this.worker === worker && this.active.has(work.id)) {
            this.armCpu(work, worker);
            worker.postMessage({
              type: 'read-result',
              id: work.id,
              error: 'Background source unavailable',
            });
          }
        }
        return;
      }
      if (message.type !== 'result') return;
      clearTimeout(work.timer);
      this.active.delete(work.id);
      if (message.error) work.reject(Error(message.error));
      else work.resolve(message.value);
      this.pump();
    });
    worker.on('error', () => this.fail(worker, 'Background worker failed'));
    worker.on('exit', () => this.fail(worker, 'Background worker exited'));
  }

  private fail(worker: Worker, reason: string) {
    if (this.worker !== worker) return;
    this.worker = undefined;
    clearTimeout(this.idle);
    for (const work of [...this.active.values(), ...this.queue]) {
      clearTimeout(work.timer);
      work.reject(Error(reason));
    }
    this.active.clear();
    this.queue = [];
    void worker.terminate();
  }

  private pump() {
    clearTimeout(this.idle);
    if (this.queue.length && !this.worker) {
      try {
        this.start();
      } catch {
        for (const work of this.queue)
          work.reject(Error('Background worker could not start'));
        this.queue = [];
        return;
      }
    }
    while (this.queue.length) {
      const active = [...this.active.values()];
      const decoders = active.filter((w) => w.task.kind === 'json').length;
      const collectors = active.length - decoders;
      // Reserve a decoding lane even when both collectors await network I/O.
      const index = this.queue.findIndex((w) =>
        w.task.kind === 'json' ? decoders < 1 : collectors < 2
      );
      if (index < 0) break;
      const work = this.queue.splice(index, 1)[0];
      this.active.set(work.id, work);
      const worker = this.worker!;
      worker.ref();
      this.armCpu(work, worker);
      worker.postMessage({ type: 'run', id: work.id, task: work.task });
    }
    if (!this.active.size && !this.queue.length && this.worker) {
      const worker = this.worker;
      worker.unref();
      this.idle = setTimeout(() => {
        if (this.worker === worker) {
          this.worker = undefined;
          void worker.terminate();
        }
      }, 60000);
      this.idle.unref();
    }
  }

  private armCpu(work: Work, worker: Worker) {
    clearTimeout(work.timer);
    work.timer = setTimeout(
      () => this.fail(worker, 'Background worker timed out'),
      this.timeoutMs
    );
  }

  close() {
    if (this.worker) this.fail(this.worker, 'Background worker stopped');
  }
}

export const backgroundWork = new BackgroundWork();
