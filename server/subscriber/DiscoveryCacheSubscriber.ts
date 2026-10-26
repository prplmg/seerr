import {
  discoveryTransactionBoundary,
  discoveryWriteBoundary,
} from '@server/lib/discoverySharedCache';
import type {
  AfterQueryEvent,
  BeforeQueryEvent,
  EntitySubscriberInterface,
  TransactionCommitEvent,
  TransactionRollbackEvent,
  TransactionStartEvent,
} from 'typeorm';
import { EventSubscriber } from 'typeorm';

// Conservative query-level invalidation also covers bulk updates, raw SQL,
// cascades and QueryBuilder.callListeners(false). Unknown SQL fails closed.
export function discoveryQueryMayWrite(query: string) {
  if (/;\s*\S/.test(query)) return true;
  // Exact connect-typeorm touch shape, SQLite and PostgreSQL. Do not exempt
  // arbitrary SQL merely because it mentions session (CTEs/multi-statements).
  if (
    /^\s*UPDATE\s+"?session"?\s+SET\s+"?expiredAt"?\s*=\s*(?:\d+|\?|\$\d+)\s+WHERE\s+"?id"?\s+IN\s*\(\s*(?:\?|\$\d+)(?:\s*,\s*(?:\?|\$\d+))*\s*\)\s*;?\s*$/i.test(
      query
    )
  )
    return false;
  if (
    /^\s*(?:BEGIN(?:\s+(?:DEFERRED|IMMEDIATE|EXCLUSIVE))?(?:\s+TRANSACTION)?|START\s+TRANSACTION|COMMIT|END|ROLLBACK|SAVEPOINT\s+typeorm_\d+|RELEASE\s+SAVEPOINT\s+typeorm_\d+|ROLLBACK\s+TO\s+SAVEPOINT\s+typeorm_\d+)\s*;?\s*$/i.test(
      query
    )
  )
    return false;
  return !/^\s*SELECT\b/i.test(query);
}
@EventSubscriber()
export class DiscoveryCacheSubscriber implements EntitySubscriberInterface {
  private active = new WeakSet<object>();
  beforeQuery(event: BeforeQueryEvent<unknown>) {
    if (discoveryQueryMayWrite(event.query)) {
      if (
        event.queryRunner.isTransactionActive ||
        this.active.has(event.queryRunner)
      )
        discoveryTransactionBoundary(event.queryRunner, true);
      discoveryWriteBoundary(true);
    }
  }
  afterQuery(event: AfterQueryEvent<unknown>) {
    if (discoveryQueryMayWrite(event.query)) discoveryWriteBoundary(false);
    // Raw SQL transaction commands do not emit TypeORM transaction events.
    if (
      event.success &&
      /^\s*(BEGIN\b|START\s+TRANSACTION\b)/i.test(event.query)
    )
      this.active.add(event.queryRunner);
    if (
      event.success &&
      /^\s*(COMMIT|END|ROLLBACK)(\s+TRANSACTION)?\s*;?\s*$/i.test(event.query)
    ) {
      this.active.delete(event.queryRunner);
      discoveryTransactionBoundary(event.queryRunner, false);
    }
  }
  afterTransactionStart(event: TransactionStartEvent) {
    this.active.add(event.queryRunner);
  }
  afterTransactionCommit(event: TransactionCommitEvent) {
    if (!event.queryRunner.isTransactionActive) {
      this.active.delete(event.queryRunner);
      discoveryTransactionBoundary(event.queryRunner, false);
    }
  }
  afterTransactionRollback(event: TransactionRollbackEvent) {
    if (!event.queryRunner.isTransactionActive) {
      this.active.delete(event.queryRunner);
      discoveryTransactionBoundary(event.queryRunner, false);
    }
  }
}
