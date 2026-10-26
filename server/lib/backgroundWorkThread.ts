import { parentPort } from 'worker_threads';
import { executeBackgroundTask } from './backgroundWorkTasks';

const port = parentPort!;
const pending = new Map<
  number,
  { resolve: (text: string) => void; reject: (error: Error) => void }
>();
port.on('message', async (message) => {
  if (message.type === 'cancel') {
    const work = pending.get(message.id);
    pending.delete(message.id);
    work?.reject(Error('Background collection cancelled'));
    return;
  }
  if (message.type === 'read-result') {
    const work = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) work?.reject(Error(message.error));
    else work?.resolve(message.text);
    return;
  }
  if (message.type !== 'run') return;
  try {
    const value = await executeBackgroundTask(
      message.task,
      (page) =>
        new Promise((resolve, reject) => {
          pending.set(message.id, { resolve, reject });
          port.postMessage({ type: 'read', id: message.id, page });
        })
    );
    port.postMessage({ type: 'result', id: message.id, value });
  } catch {
    // Never send source contents, tokens, URLs or arbitrary parser errors to logs.
    port.postMessage({
      type: 'result',
      id: message.id,
      error: `Background ${message.task.kind} failed`,
    });
  }
});
