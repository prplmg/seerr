import fs from 'fs';
import assert from 'node:assert/strict';
import { it } from 'node:test';
import os from 'os';
import path from 'path';
import {
  closeTaskStores,
  exportTaskStore,
  initializeTaskStore,
  readTaskDocument,
  updateTaskDocument,
} from './letterboxdTaskStore';
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-ledger-'));
  return {
    root,
    file: (name: string) => path.join(root, name),
    close: () => {
      closeTaskStores();
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}
it('migrates once, preserves IDs/settings, survives reopen and never trusts stale JSON', () => {
  const f = fixture(),
    file = f.file('letterboxd-write-queue.json');
  const original = {
    version: 1,
    settings: { 7: { enabled: true, account: 'alice' } },
    intents: [
      {
        id: 'one',
        state: 'unknown',
        film: 'jaws',
        account: 'alice',
        desired: { watchedDate: '2026-11-03' },
      },
    ],
  };
  fs.writeFileSync(file, JSON.stringify(original));
  try {
    assert.deepEqual(
      readTaskDocument(file, () => null),
      original
    );
    updateTaskDocument(
      file,
      () => original,
      (s) => {
        s.intents[0].state = 'verified';
      }
    );
    closeTaskStores();
    assert.equal(
      readTaskDocument(file, () => original).intents[0].state,
      'verified'
    );
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), original);
    fs.writeFileSync(file, 'invalid');
    assert.equal(
      readTaskDocument(file, () => original).intents[0].state,
      'verified'
    );
  } finally {
    f.close();
  }
});
it('receipt and queue commit atomically, including nested update rollback', () => {
  const f = fixture(),
    queue = f.file('letterboxd-write-queue.json'),
    receipt = f.file('letterboxd-sync-receipts.json');
  const empty = () => ({
    version: 1,
    intents: [{ id: 'one', state: 'unknown' }],
  });
  try {
    readTaskDocument(queue, empty);
    assert.throws(() =>
      updateTaskDocument(queue, empty, (s) => {
        updateTaskDocument(
          receipt,
          () => ({ entries: [] as string[] }),
          (r) => {
            r.entries.push('one');
          }
        );
        s.intents[0].state = 'verified';
        throw Error('interrupted');
      })
    );
    assert.deepEqual(
      readTaskDocument(receipt, () => ({ entries: [] })),
      { entries: [] }
    );
    assert.equal(readTaskDocument(queue, empty).intents[0].state, 'unknown');
    updateTaskDocument(queue, empty, (s) => {
      updateTaskDocument(
        receipt,
        () => ({ entries: [] as string[] }),
        (r) => {
          r.entries.push('one');
        }
      );
      s.intents[0].state = 'verified';
    });
    closeTaskStores();
    assert.equal(readTaskDocument(queue, empty).intents[0].state, 'verified');
    assert.deepEqual(
      readTaskDocument(receipt, () => ({ entries: [] })),
      { entries: ['one'] }
    );
  } finally {
    f.close();
  }
});
it('preserves browser identity/settings and public-list ordering with separate task rows', () => {
  const f = fixture(),
    file = f.file('letterboxd-browser.json'),
    lists = f.file('discovery-browser.json');
  const data = {
    version: 1,
    tokenHash: 'unchanged',
    bindings: [
      {
        instance: 'profile',
        userId: 14,
        username: 'alice',
        enabled: true,
        job: { id: 'export-one', kind: 'export', state: 'running', created: 1 },
      },
    ],
  };
  try {
    fs.writeFileSync(file, JSON.stringify(data));
    assert.deepEqual(
      readTaskDocument(file, () => null),
      data
    );
    updateTaskDocument(
      lists,
      () => [] as { id: string; state: string }[],
      (s) => {
        s.push(
          { id: 'two', state: 'queued' },
          { id: 'one', state: 'received' }
        );
      }
    );
    closeTaskStores();
    assert.deepEqual(
      readTaskDocument(file, () => null),
      data
    );
    assert.deepEqual(
      readTaskDocument(lists, () => []).map((x: any) => x.id),
      ['two', 'one']
    );
  } finally {
    f.close();
  }
});
it('rejects duplicate task IDs and asynchronous mutations without a partial commit', () => {
  const f = fixture(),
    file = f.file('discovery-browser.json');
  try {
    assert.throws(() =>
      updateTaskDocument(
        file,
        () => [] as { id: string }[],
        (s) => {
          s.push({ id: 'one' }, { id: 'one' });
        }
      )
    );
    assert.deepEqual(
      readTaskDocument(file, () => []),
      []
    );
    assert.throws(() =>
      updateTaskDocument(
        file,
        () => [],
        () => Promise.resolve()
      )
    );
  } finally {
    f.close();
  }
});
it('a caught nested failure rolls back its receipt independently of the outer transaction', () => {
  const f = fixture(),
    queue = f.file('discovery-browser.json'),
    receipt = f.file('letterboxd-sync-receipts.json');
  try {
    updateTaskDocument(
      queue,
      () => [] as { id: string }[],
      (rows) => {
        try {
          updateTaskDocument(
            receipt,
            () => ({ entries: [] as string[] }),
            (r) => {
              r.entries.push('uncommitted');
              throw Error('interrupted');
            }
          );
        } catch {}
        rows.push({ id: 'safe' });
      }
    );
    assert.deepEqual(
      readTaskDocument(queue, () => []),
      [{ id: 'safe' }]
    );
    assert.deepEqual(
      readTaskDocument(receipt, () => ({ entries: [] })),
      { entries: [] }
    );
  } finally {
    f.close();
  }
});

it('migrates the complete ledger before scheduling and exports current rollback state', () => {
  const f = fixture();
  try {
    fs.writeFileSync(
      f.file('letterboxd-browser.json'),
      JSON.stringify({ version: 2, bindings: [] })
    );
    assert.throws(() => initializeTaskStore(f.root));
    fs.writeFileSync(
      f.file('letterboxd-browser.json'),
      JSON.stringify({ version: 1, bindings: [] })
    );
    assert.deepEqual(initializeTaskStore(f.root), { documents: 5, tasks: 0 });
    updateTaskDocument(
      f.file('discovery-browser.json'),
      () => [] as { id: string; state: string }[],
      (rows) => {
        rows.push({ id: 'late', state: 'received' });
      }
    );
    const target = path.join(f.root, 'rollback');
    exportTaskStore(f.root, target);
    assert.deepEqual(
      JSON.parse(
        fs.readFileSync(path.join(target, 'discovery-browser.json'), 'utf8')
      ),
      [{ id: 'late', state: 'received' }]
    );
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(target, 'complete.json'), 'utf8'))
        .documents.length,
      5
    );
    assert.throws(() => exportTaskStore(f.root, target));
  } finally {
    f.close();
  }
});
