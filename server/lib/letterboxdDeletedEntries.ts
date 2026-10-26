import { appDataPath } from '@server/utils/appDataVolume';
import fs from 'fs';
import path from 'path';
import { letterboxdEntryIdentity } from './letterboxdImport';

export type VerifiedDeletion = {
  userId: number;
  entryId: string;
  verifiedAt: string;
  evidence: string;
};

// Absence from a bounded RSS feed is NOT proof of deletion. Only explicitly
// verified exact-entry removals may enter this durable suppression list.
export function parseVerifiedDeletions(value: unknown): VerifiedDeletion[] {
  const data = value as { version?: number; entries?: VerifiedDeletion[] };
  if (data?.version !== 1 || !Array.isArray(data.entries))
    throw Error('Invalid verified deletions');
  for (const row of data.entries) {
    if (
      !Number.isSafeInteger(row.userId) ||
      row.userId < 1 ||
      !row.entryId ||
      letterboxdEntryIdentity(row.entryId) !== row.entryId ||
      !Number.isFinite(Date.parse(row.verifiedAt)) ||
      typeof row.evidence !== 'string' ||
      !row.evidence.trim()
    )
      throw Error('Invalid verified deletion');
  }
  return data.entries;
}

export function wasVerifiedDeleted(userId: number, entryId: string): boolean {
  const file = path.join(appDataPath(), 'letterboxd-verified-deletions.json');
  if (!fs.existsSync(file)) return false;
  return parseVerifiedDeletions(JSON.parse(fs.readFileSync(file, 'utf8'))).some(
    (row) => row.userId === userId && row.entryId === entryId
  );
}
