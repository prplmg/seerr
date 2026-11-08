/** One streaming request, no progress polling and no artificial timers/stages. */
export async function searchStream<T>(
  body: unknown,
  progress: (message: string) => void,
  endpoint = '/api/v1/ai-search',
  signal?: AbortSignal
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 240000);
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) controller.abort();
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      const error = await response.json();
      throw Error(error.message || 'Search failed. Please try again.');
    }
    if (!response.body)
      throw Error('Could not read search progress. Please retry.');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let result: T | undefined;
    const consume = (line: string) => {
      if (!line.trim()) return;
      const event = JSON.parse(line);
      if (event.kind === 'progress') progress(event.message);
      if (event.kind === 'error') throw Error(event.message);
      if (event.kind === 'result') result = event.data;
    };
    try {
      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        let boundary: number;
        while ((boundary = buffer.indexOf('\n')) >= 0) {
          consume(buffer.slice(0, boundary));
          buffer = buffer.slice(boundary + 1);
        }
        if (done) break;
      }
      consume(buffer);
      if (!result) throw Error('Search was interrupted. Please retry.');
      return result;
    } finally {
      reader.releaseLock();
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}
