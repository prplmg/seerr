import {
  LetterboxdExportAudit,
  LetterboxdExportBaseline,
} from '@server/entity/LetterboxdExport';
import { randomUUID } from 'crypto';
import type { DataSource, EntityManager } from 'typeorm';
import {
  commitLetterboxdExport,
  type ExportBaseline,
  type ExportTransaction,
} from './letterboxdExportTransaction';

// SQLite's TypeORM driver shares one query runner/connection. Account-scoped
// review locks do not prevent two users from interleaving BEGIN/COMMIT on it.
// Queue only export commits, not archive parsing or remote metadata resolution.
const sqliteCommits = new WeakMap<DataSource, Promise<void>>();
async function withExportCommit<T>(source: DataSource, work: () => Promise<T>) {
  if (
    source.options.type !== 'sqlite' &&
    source.options.type !== 'better-sqlite3'
  )
    return work();
  const previous = sqliteCommits.get(source) ?? Promise.resolve();
  let release!: () => void;
  const tail = new Promise<void>((resolve) => {
    release = resolve;
  });
  sqliteCommits.set(source, tail);
  await previous;
  try {
    return await work();
  } finally {
    release();
    if (sqliteCommits.get(source) === tail) sqliteCommits.delete(source);
  }
}

export async function commitExportToDatabase(
  dataSource: DataSource,
  userId: number,
  incoming: ExportBaseline,
  expectedRevision: string | null,
  apply: (
    manager: EntityManager,
    ...args: Parameters<ExportTransaction['apply']>
  ) => Promise<void>
) {
  if (!Number.isSafeInteger(userId) || userId <= 0)
    throw Error('Invalid export user');
  return withExportCommit(dataSource, () =>
    commitLetterboxdExport(incoming, expectedRevision, (work) =>
      dataSource.transaction('SERIALIZABLE', async (manager) => {
        const repo = manager.getRepository(LetterboxdExportBaseline);
        return work({
          readBaseline: async () => {
            const row = await repo.findOneBy({ userId });
            if (!row) return null;
            if (row.account !== incoming.snapshot.account)
              throw Error('Export account mapping changed');
            return JSON.parse(row.value) as ExportBaseline;
          },
          apply: (diff, snapshot) => apply(manager, diff, snapshot),
          saveBaseline: (value) =>
            repo
              .save({
                userId,
                account: value.snapshot.account,
                value: JSON.stringify(value),
              })
              .then(() => undefined),
          audit: (value) =>
            manager
              .getRepository(LetterboxdExportAudit)
              .save({
                id: randomUUID(),
                userId,
                account: incoming.snapshot.account,
                revision: value.revision,
                capturedAt: new Date(value.capturedAt).toISOString(),
                changes: value.changes,
              })
              .then(() => undefined),
        });
      })
    )
  );
}
