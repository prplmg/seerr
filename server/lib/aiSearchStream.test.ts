// The server test runner has no @app alias; exercise the browser parser directly.
/* eslint-disable no-relative-import-paths/no-relative-import-paths */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { searchStream } from '../../src/components/AiSearch/searchStream';

test('search progress decodes split chunks and returns result over a single request', async (t) => {
  const encoded = new TextEncoder().encode(
    JSON.stringify({ kind: 'progress', message: 'Finding movies…' }) +
      '\n' +
      JSON.stringify({ kind: 'result', data: { results: [1] } }) +
      '\n'
  );
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return new Response(
      new ReadableStream({
        start(controller) {
          for (let i = 0; i < encoded.length; i += 2)
            controller.enqueue(encoded.slice(i, i + 2));
          controller.close();
        },
      })
    );
  });
  const progress: string[] = [];
  assert.deepEqual(
    await searchStream({}, (message) => progress.push(message)),
    { results: [1] }
  );
  assert.deepEqual(progress, ['Finding movies…']);
  assert.equal(calls, 1);
});
test('streamed and HTTP errors are shown, truncated streams cannot become successful results', async (t) => {
  const fetch = t.mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response(
        JSON.stringify({ kind: 'error', message: 'History unavailable' }) + '\n'
      )
  );
  await assert.rejects(
    searchStream({}, () => {}),
    /History unavailable/
  );
  fetch.mock.mockImplementation(
    async () =>
      new Response(JSON.stringify({ message: 'Not configured' }), {
        status: 503,
      })
  );
  await assert.rejects(
    searchStream({}, () => {}),
    /Not configured/
  );
  fetch.mock.mockImplementation(
    async () =>
      new Response(
        JSON.stringify({ kind: 'progress', message: 'Finding titles…' }) + '\n'
      )
  );
  await assert.rejects(
    searchStream({}, () => {}),
    /interrupted/
  );
});
