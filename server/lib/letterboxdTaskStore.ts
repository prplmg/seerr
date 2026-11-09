/* eslint-disable @typescript-eslint/no-explicit-any */
import fs from 'fs';
import { DatabaseSync } from 'node:sqlite';
import path from 'path';

// The JSON files are migration inputs/rollback evidence only. Once imported,
// this SQLite ledger is authoritative; no dual writes or JSON fallback.
const layouts: Record<string, string | null> = {
  'letterboxd-write-queue.json': 'intents',
  'letterboxd-observations.json': 'requests',
  'discovery-browser.json': null,
};
type Json = Record<string, any>; // Persist existing typed adapter payloads losslessly.
const stores = new Map<string, { db: DatabaseSync; depth: number }>();
function connection(file: string) {
  const location = path.join(
    path.dirname(file),
    'db',
    'letterboxd-tasks.sqlite3'
  );
  let store = stores.get(location);
  if (!store) {
    fs.mkdirSync(path.dirname(location), { recursive: true });
    const db = new DatabaseSync(location);
    fs.chmodSync(location, 0o600);
    db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS documents(name TEXT PRIMARY KEY, metadata TEXT NOT NULL, importedAt INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS tasks(namespace TEXT NOT NULL,id TEXT NOT NULL,position INTEGER NOT NULL,
        account TEXT,subject TEXT,state TEXT NOT NULL,nextAttemptAt INTEGER,payload TEXT NOT NULL,
        PRIMARY KEY(namespace,id));
      CREATE INDEX IF NOT EXISTS task_status ON tasks(namespace,state,nextAttemptAt);
      CREATE TABLE IF NOT EXISTS transitions(sequence INTEGER PRIMARY KEY,namespace TEXT NOT NULL,
        taskId TEXT NOT NULL,at INTEGER NOT NULL,fromState TEXT,toState TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS controls(key TEXT PRIMARY KEY,value TEXT NOT NULL);`);
    store = { db, depth: 0 };
    stores.set(location, store);
  }
  return store;
}
function transaction<T>(file: string, work: (db: DatabaseSync) => T): T {
  const store = connection(file),
    outer = store.depth === 0;
  const savepoint = `task_${store.depth}`;
  store.db.exec(outer ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${savepoint}`);
  store.depth++;
  try {
    const result = work(store.db);
    if (result && typeof (result as any).then === 'function')
      throw Error('Async task transaction prohibited');
    store.db.exec(outer ? 'COMMIT' : `RELEASE ${savepoint}`);
    return result;
  } catch (error) {
    if (outer) store.db.exec('ROLLBACK');
    else {
      store.db.exec(`ROLLBACK TO ${savepoint}`);
      store.db.exec(`RELEASE ${savepoint}`);
    }
    throw error;
  } finally {
    store.depth--;
  }
}
function split(name: string, value: any): { metadata: any; tasks: Json[] } {
  if (name === 'letterboxd-browser.json') {
    return {
      metadata: {
        ...value,
        bindings: value.bindings.map(({ job, ...b }: Json) => b),
      },
      tasks: value.bindings
        .filter((b: Json) => b.job)
        .map((b: Json) => ({
          ...b.job,
          _binding: b.instance,
          account: b.username,
        })),
    };
  }
  if (!(name in layouts)) return { metadata: value, tasks: [] };
  const key = layouts[name];
  if (key === null) return { metadata: null, tasks: value };
  const { [key]: tasks, ...metadata } = value;
  return { metadata, tasks };
}
function save(db: DatabaseSync, name: string, value: any) {
  const { metadata, tasks } = split(name, value);
  if (
    !Array.isArray(tasks) ||
    tasks.some((t) => !t.id || typeof t.id !== 'string') ||
    new Set(tasks.map((t) => t.id)).size !== tasks.length
  )
    throw Error('Invalid task identities');
  db.prepare(
    'INSERT INTO documents VALUES(?,?,?) ON CONFLICT(name) DO UPDATE SET metadata=excluded.metadata WHERE documents.metadata<>excluded.metadata'
  ).run(name, JSON.stringify(metadata), Date.now());
  const old = new Map(
    (
      db
        .prepare(
          'SELECT id,state,payload,position FROM tasks WHERE namespace=?'
        )
        .all(name) as {
        id: string;
        state: string;
        payload: string;
        position: number;
      }[]
    ).map((t) => [t.id, t])
  );
  const write =
    db.prepare(`INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(namespace,id) DO UPDATE SET
    position=excluded.position,account=excluded.account,subject=excluded.subject,state=excluded.state,nextAttemptAt=excluded.nextAttemptAt,payload=excluded.payload`);
  tasks.forEach((t, position) => {
    const payload = JSON.stringify(t),
      state = t.state || 'queued';
    if (
      old.get(t.id)?.payload !== payload ||
      old.get(t.id)?.position !== position
    )
      write.run(
        name,
        t.id,
        position,
        t.account || null,
        t.film || t.url || null,
        state,
        t.retryAt || t.recovery?.nextAttemptAt || null,
        payload
      );
    if (old.get(t.id)?.state !== state)
      db.prepare(
        'INSERT INTO transitions(namespace,taskId,at,fromState,toState) VALUES(?,?,?,?,?)'
      ).run(name, t.id, Date.now(), old.get(t.id)?.state || null, state);
    old.delete(t.id);
  });
  for (const id of old.keys())
    db.prepare('DELETE FROM tasks WHERE namespace=? AND id=?').run(name, id);
}
function read<T>(db: DatabaseSync, file: string, empty: () => T): T {
  const name = path.basename(file);
  let row = db
    .prepare('SELECT metadata FROM documents WHERE name=?')
    .get(name) as { metadata: string } | undefined;
  if (!row) {
    const legacy = fs.existsSync(file)
      ? JSON.parse(fs.readFileSync(file, 'utf8'))
      : empty();
    save(db, name, legacy);
    row = db
      .prepare('SELECT metadata FROM documents WHERE name=?')
      .get(name) as { metadata: string };
  }
  const metadata = JSON.parse(row.metadata);
  const tasks = db
    .prepare('SELECT payload FROM tasks WHERE namespace=? ORDER BY position')
    .all(name)
    .map((r) => JSON.parse(r.payload as string));
  if (name === 'letterboxd-browser.json') {
    metadata.bindings = metadata.bindings.map((b: Json) => {
      const task = tasks.find((t) => t._binding === b.instance);
      if (!task) return b;
      const { _binding, account, ...job } = task;
      return { ...b, job };
    });
    return metadata;
  }
  if (!(name in layouts)) return metadata;
  const key = layouts[name];
  return key === null ? (tasks as T) : { ...metadata, [key]: tasks };
}
export function readTaskDocument<T>(file: string, empty: () => T): T {
  return transaction(file, (db) => read(db, file, empty));
}
export function updateTaskDocument<S, T>(
  file: string,
  empty: () => S,
  change: (state: S) => T
): T {
  return transaction(file, (db) => {
    const state = read(db, file, empty),
      result = change(state);
    if (result && typeof (result as any).then === 'function')
      throw Error('Async task update prohibited');
    save(db, path.basename(file), state);
    return result;
  });
}
export function closeTaskStores() {
  for (const store of stores.values()) {
    if (store.depth) throw Error('Active task transaction');
    store.db.close();
  }
  stores.clear();
}

const migrationDefaults: Record<string, () => any> = {
  'letterboxd-write-queue.json': () => ({
    version: 1,
    settings: {},
    intents: [],
  }),
  'letterboxd-observations.json': () => ({ version: 1, requests: [] }),
  'letterboxd-browser.json': () => ({ version: 1, bindings: [] }),
  'discovery-browser.json': () => [],
  'letterboxd-sync-receipts.json': () => ({ version: 1, entries: [] }),
};
/** Run before schedulers or worker endpoints start. All five stores migrate together. */
export function initializeTaskStore(directory: string) {
  const anchor = path.join(directory, 'letterboxd-browser.json');
  return transaction(anchor, (db) => {
    for (const [name, empty] of Object.entries(migrationDefaults)) {
      const value = read(db, path.join(directory, name), empty);
      if (name === 'discovery-browser.json') {
        if (!Array.isArray(value)) throw Error('Invalid list migration');
      } else if (value.version !== 1)
        throw Error(`Invalid migration version: ${name}`);
    }
    const check = db.prepare('PRAGMA quick_check').get();
    if (!check || Object.values(check)[0] !== 'ok')
      throw Error('Task ledger integrity check failed');
    return {
      documents: Number(
        db.prepare('SELECT COUNT(*) AS count FROM documents').get()!.count
      ),
      tasks: Number(
        db.prepare('SELECT COUNT(*) AS count FROM tasks').get()!.count
      ),
    };
  });
}
/** Produce CURRENT legacy-format state for rollback; never restore stale pre-cutover JSON. */
export function exportTaskStore(directory: string, destination: string) {
  if (fs.existsSync(destination))
    throw Error('Rollback export destination must be new');
  fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
  return transaction(path.join(directory, 'letterboxd-browser.json'), (db) => {
    for (const [name, empty] of Object.entries(migrationDefaults))
      fs.writeFileSync(
        path.join(destination, name),
        JSON.stringify(read(db, path.join(directory, name), empty)),
        { flag: 'wx', mode: 0o600 }
      );
    fs.writeFileSync(
      path.join(destination, 'complete.json'),
      JSON.stringify({
        version: 1,
        createdAt: Date.now(),
        documents: Object.keys(migrationDefaults),
      }),
      { flag: 'wx', mode: 0o600 }
    );
  });
}
export function taskStoreHealth(directory: string) {
  const db = connection(path.join(directory, 'letterboxd-browser.json')).db;
  return db
    .prepare(
      `SELECT namespace,state,COUNT(*) AS count,MIN(nextAttemptAt) AS nextAttemptAt
    FROM tasks GROUP BY namespace,state ORDER BY namespace,state`
    )
    .all();
}
