import { appDataPath } from '@server/utils/appDataVolume';
import { createHash, randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';

export type AccountMapping = {
  userId: number;
  avatarPlexId: string | null;
  avatarSource?: 'gravatar';
  discoveryEnabled?: boolean;
  playbackPlexId: string | null;
  watchlistPlexId: string | null;
};
export type MappingDocument = { version: 1; users: AccountMapping[] };
export function validateAccountMappings(value: unknown): MappingDocument {
  const doc = value as MappingDocument;
  if (
    !doc ||
    doc.version !== 1 ||
    !Array.isArray(doc.users) ||
    doc.users.length > 10000
  )
    throw Error('Invalid mapping document');
  const ids = new Set<number>();
  for (const row of doc.users) {
    if (
      !row ||
      !Number.isSafeInteger(row.userId) ||
      row.userId < 1 ||
      ids.has(row.userId) ||
      Object.keys(row)
        .filter((key) => !['avatarSource', 'discoveryEnabled'].includes(key))
        .sort()
        .join(',') !== 'avatarPlexId,playbackPlexId,userId,watchlistPlexId'
    )
      throw Error('Invalid or duplicate user mapping');
    ids.add(row.userId);
    if (row.discoveryEnabled !== undefined && typeof row.discoveryEnabled !== 'boolean')
      throw Error('Invalid discovery flag');
    if (
      row.avatarSource !== undefined &&
      (row.avatarSource !== 'gravatar' || row.avatarPlexId !== null)
    )
      throw Error('Invalid avatar source');
    for (const field of [
      'avatarPlexId',
      'playbackPlexId',
      'watchlistPlexId',
    ] as const)
      if (
        row[field] !== null &&
        (typeof row[field] !== 'string' ||
          !/^[1-9][0-9]{0,19}$/.test(row[field]!))
      )
        throw Error('Invalid Plex profile ID');
  }
  return {
    version: 1,
    users: doc.users
      .map((row) => ({ ...row }))
      .sort((a, b) => a.userId - b.userId),
  };
}
const filename = () => path.join(appDataPath(), 'account-mappings.json');
export function readAccountMappings(): MappingDocument {
  try {
    return validateAccountMappings(
      JSON.parse(fs.readFileSync(filename(), 'utf8'))
    );
  } catch (error) {
    if (error.code === 'ENOENT') return { version: 1, users: [] };
    throw error;
  }
}
export const mappingRevision = (doc: MappingDocument) =>
  createHash('sha256').update(JSON.stringify(doc)).digest('hex');
export function saveAccountMappings(value: unknown, expected: string) {
  const next = validateAccountMappings(value);
  // No await between compare and atomic replacement: concurrent requests cannot interleave.
  if (mappingRevision(readAccountMappings()) !== expected)
    throw Error('Mapping revision conflict');
  const target = filename(),
    temp = target + '.' + randomUUID() + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(next, null, 2), {
    flag: 'wx',
    mode: 0o600,
  });
  try {
    fs.renameSync(temp, target);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
  return { document: next, revision: mappingRevision(next) };
}
export function mappedPlaybackProfiles(legacy: {
  version?: number;
  users?: Record<string, { plexUserId: string; label?: string }>;
}) {
  const users = { ...legacy.users };
  for (const row of readAccountMappings().users) {
    if (row.playbackPlexId)
      users[String(row.userId)] = {
        plexUserId: row.playbackPlexId,
        label: row.playbackPlexId,
      };
    else delete users[String(row.userId)];
  }
  return { ...legacy, version: 1, users };
}
