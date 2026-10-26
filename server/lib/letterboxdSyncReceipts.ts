import { appDataPath } from '@server/utils/appDataVolume';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { letterboxdEntryIdentity } from './letterboxdImport';
import type { ReviewFields } from './letterboxdReconcile';

export type SyncReceipt = {
  userId: number;
  account: string;
  originId: string;
  entryId: string;
  baseline?: ReviewFields;
  diaryBaseline?: { watchedDate: string; rewatch: boolean };
  verifiedAt?: number;
  echoObserved?: boolean;
  boundDiaryOriginId?: string;
};
// One explicit local review may decorate an existing playback diary entry.
// Keep the playback receipt: it is the durable guard against a second log.
export function isBoundDiaryPair(a: SyncReceipt, b: SyncReceipt): boolean {
  const review = a.boundDiaryOriginId ? a : b;
  const diary = review === a ? b : a;
  return !!(review.baseline && review.originId.startsWith('local:') &&
    diary.diaryBaseline && !diary.baseline && !diary.boundDiaryOriginId &&
    /^(tautulli|party):[a-f0-9]{64}$/.test(diary.originId) &&
    review.boundDiaryOriginId === diary.originId &&
    review.userId === diary.userId && review.account === diary.account &&
    review.entryId === diary.entryId);
}
export function boundPlaybackOrigin(
  rows: readonly SyncReceipt[],
  userId: number,
  account: string,
  entryId: string | undefined,
  local: {externalEntryId: string | null; watchedDate: string | null} | null
): string | undefined {
  if (!entryId || !local || local.externalEntryId !== entryId || !local.watchedDate) return;
  const diaries = rows.filter(r => r.userId === userId && r.account === account &&
    r.entryId === entryId && r.diaryBaseline && !r.baseline &&
    Number.isFinite(r.verifiedAt) && r.verifiedAt! > 0 &&
    /^(tautulli|party):[a-f0-9]{64}$/.test(r.originId));
  if (diaries.length === 1 && local.watchedDate === diaries[0].diaryBaseline!.watchedDate)
    return diaries[0].originId;
}
// Only call after independently verifying a successful remote write.
// No receipt for an uncertain create: it must be reconciled, never blindly retried.
export function mergeSyncReceipt(
  rows: SyncReceipt[],
  input: SyncReceipt
): SyncReceipt[] {
  const entryId = letterboxdEntryIdentity(input.entryId);
  const account = input.account.toLowerCase();
  if (
    !Number.isSafeInteger(input.userId) ||
    input.userId < 1 ||
    !/^[a-z0-9_]{1,40}$/.test(account) ||
    !input.originId ||
    input.originId.length > 300 ||
    !entryId ||
    new URL(entryId).pathname.split('/')[1] !== account
  )
    throw Error('Invalid sync receipt');
  const next = { ...rows.find(r => r.userId === input.userId && r.originId === input.originId), ...input, account, entryId };
  if (next.boundDiaryOriginId !== undefined &&
      (!next.baseline || !next.originId.startsWith('local:') ||
       !/^(tautulli|party):[a-f0-9]{64}$/.test(next.boundDiaryOriginId)))
    throw Error('Invalid bound diary identity');
  if (input.diaryBaseline !== undefined) {
    const diary = input.diaryBaseline;
    if (
      !diary ||
      typeof diary.watchedDate !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(diary.watchedDate) ||
      !Number.isFinite(Date.parse(diary.watchedDate)) ||
      new Date(diary.watchedDate).toISOString().slice(0, 10) !==
        diary.watchedDate ||
      typeof diary.rewatch !== 'boolean'
    )
      throw Error('Invalid diary baseline');
  }
  if (
    input.baseline &&
    (typeof input.baseline.text !== 'string' ||
      input.baseline.text.length > 50000 ||
      typeof input.baseline.spoiler !== 'boolean' ||
      (input.baseline.rating !== null &&
        (typeof input.baseline.rating !== 'number' ||
          input.baseline.rating < 0.5 ||
          input.baseline.rating > 5 ||
          !Number.isInteger(input.baseline.rating * 2))))
  )
    throw Error('Invalid receipt baseline');
  if (
    input.verifiedAt !== undefined &&
    (!Number.isFinite(input.verifiedAt) || input.verifiedAt < 0)
  )
    throw Error('Invalid verification date');
  if (
    input.echoObserved !== undefined &&
    typeof input.echoObserved !== 'boolean'
  )
    throw Error('Invalid echo state');
  const related = rows.filter(
    (r) =>
      r.userId === input.userId &&
      ((r.account === account && r.entryId === entryId) ||
        r.originId === input.originId)
  );
  if (
    related.some(
      (r) =>
        r.account !== account ||
        (r.originId !== next.originId && !isBoundDiaryPair(r, next)) ||
        r.entryId !== next.entryId
    )
  )
    throw Error('Sync identity conflict');
  if (
    related.some(
      (r) => r.originId === next.originId &&
        r.verifiedAt !== undefined &&
        input.verifiedAt !== undefined &&
        input.verifiedAt < r.verifiedAt
    )
  )
    throw Error('Stale sync receipt');
  const existing = related.find(r => r.originId === next.originId);
  return existing
    ? rows.map((r) => (r === existing ? { ...r, ...next } : r))
    : [...rows, next];
}
export function outboundCreateDisposition(
  rows: SyncReceipt[],
  input: {
    userId: number;
    account: string;
    originId: string;
    source: 'local' | 'letterboxd';
  }
): 'imported-no-create' | 'already-linked' | 'account-changed' | 'unlinked' {
  if (input.source === 'letterboxd') return 'imported-no-create';
  const row = rows.find(
    (r) => r.userId === input.userId && r.originId === input.originId
  );
  return !row
    ? 'unlinked'
    : row.account === input.account.toLowerCase()
      ? 'already-linked'
      : 'account-changed';
}
export function readSyncReceipts(): SyncReceipt[] {
  try {
    const doc = JSON.parse(
      fs.readFileSync(
        path.join(appDataPath(), 'letterboxd-sync-receipts.json'),
        'utf8'
      )
    );
    if (doc.version !== 1 || !Array.isArray(doc.entries))
      throw Error('Invalid receipt store');
    return doc.entries.reduce(
      (rows: SyncReceipt[], entry: SyncReceipt) =>
        mergeSyncReceipt(rows, entry),
      []
    );
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}
export function recordSyncReceipt(receipt: SyncReceipt) {
  const entries = mergeSyncReceipt(readSyncReceipts(), receipt);
  const file = path.join(appDataPath(), 'letterboxd-sync-receipts.json');
  const temp = file + '.' + randomUUID() + '.tmp';
  fs.writeFileSync(temp, JSON.stringify({ version: 1, entries }), {
    flag: 'wx',
    mode: 0o600,
  });
  try {
    fs.renameSync(temp, file);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}
