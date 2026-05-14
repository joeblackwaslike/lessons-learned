import { sleep, clamp } from './utils.js';

const DEFAULT_CONCURRENCY = 3;
const DEFAULT_MAX_RETRIES = 3;
const BASE_DELAY_MS = 200;

/**
 * Processes a queue of tasks with concurrency control, retry logic, and
 * exponential backoff. Returns a result summary.
 *
 * @param {Array<{id: string, payload: unknown, priority?: number}>} tasks
 * @param {(task: object) => Promise<unknown>} handler
 * @param {object} [options]
 * @param {number} [options.concurrency=3]
 * @param {number} [options.maxRetries=3]
 * @param {boolean} [options.stopOnError=false]
 * @returns {Promise<{succeeded: string[], failed: Array<{id: string, error: string}>, skipped: string[]}>}
 */
export async function processQueue(tasks, handler, options = {}) {
  const {
    concurrency = DEFAULT_CONCURRENCY,
    maxRetries = DEFAULT_MAX_RETRIES,
    stopOnError = false,
  } = options;

  const sorted = [...tasks].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

  const succeeded = [];
  const failed = [];
  const skipped = [];
  let aborted = false;

  const semaphore = new Semaphore(clamp(concurrency, 1, 32));

  await Promise.all(
    sorted.map(async task => {
      if (aborted) {
        skipped.push(task.id);
        return;
      }

      await semaphore.acquire();
      try {
        const result = await runWithRetry(task, handler, maxRetries);
        succeeded.push(task.id);
        return result;
      } catch (err) {
        failed.push({ id: task.id, error: err.message });
        if (stopOnError) aborted = true;
      } finally {
        semaphore.release();
      }
    })
  );

  return { succeeded, failed, skipped };
}

async function runWithRetry(task, handler, maxRetries) {
  let attempt = 0;
  while (attempt <= maxRetries) {
    try {
      return await handler(task);
    } catch (err) {
      if (attempt === maxRetries) throw err;
      const delay = BASE_DELAY_MS * 2 ** attempt;
      await sleep(delay);
      attempt++;
    }
  }
}

class Semaphore {
  constructor(limit) {
    this._limit = limit;
    this._count = 0;
    this._queue = [];
  }

  acquire() {
    if (this._count < this._limit) {
      this._count++;
      return Promise.resolve();
    }
    return new Promise(resolve => this._queue.push(resolve));
  }

  release() {
    const next = this._queue.shift();
    if (next) {
      next();
    } else {
      this._count--;
    }
  }
}

export function enqueue(queue, task) {
  if (!task?.id) throw new Error('Task must have an id');
  queue.push({ priority: 0, ...task });
  return queue;
}

export function dequeue(queue) {
  if (!queue.length) return null;
  const maxPriority = Math.max(...queue.map(t => t.priority ?? 0));
  const idx = queue.findIndex(t => (t.priority ?? 0) === maxPriority);
  return queue.splice(idx, 1)[0];
}
