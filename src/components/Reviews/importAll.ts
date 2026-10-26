export type ImportBatch<T> = {
  results: T[];
  total: number;
  nextOffset: number | null;
};

// Sequential, rate-limit-friendly requests. Advance only after a committed
// batch, so a failed/uncertain request can safely be retried at the same offset.
export async function importAll<T>({
  start,
  send,
  progress,
  stopped,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}: {
  start: number;
  send: (offset: number) => Promise<ImportBatch<T>>;
  progress: (done: number, batch: ImportBatch<T>) => void;
  stopped: () => boolean;
  wait?: (ms: number) => Promise<unknown>;
}) {
  let offset = start;
  while (!stopped()) {
    const batch = await send(offset);
    const next = batch.nextOffset;
    if (
      !Number.isInteger(batch.total) ||
      batch.total < offset ||
      (next !== null &&
        (!Number.isInteger(next) || next <= offset || next >= batch.total))
    )
      throw Error('Invalid import progress');
    progress(next ?? batch.total, batch);
    if (next === null) return true;
    offset = next;
    await wait(2200); // At most 28 commits/minute, below the API's 30/min limit.
  }
  return false;
}
