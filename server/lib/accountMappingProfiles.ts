import { getRepository } from '@server/datasource';
import { User } from '@server/entity/User';
import { appDataPath } from '@server/utils/appDataVolume';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { parseStringPromise } from 'xml2js';
import { readAccountMappings, type AccountMapping } from './accountMappings';

export async function plexMappingProfiles(): Promise<
  { id: string; title: string; thumb: string }[]
> {
  const owner = await getRepository(User).findOne({
    where: { id: 1 },
    select: ['id', 'plexToken'],
  });
  if (!owner?.plexToken) throw Error('Plex owner credentials unavailable');
  const response = await axios.get('https://plex.tv/api/home/users', {
    headers: { 'X-Plex-Token': owner.plexToken, Accept: 'application/xml' },
    timeout: 10000,
    maxRedirects: 0,
    responseType: 'text',
  });
  const parsed = await parseStringPromise(response.data);
  const rows = parsed.MediaContainer?.User;
  if (!Array.isArray(rows)) throw Error('Plex profiles unavailable');
  return rows.map((row) => ({
    id: String(row.$.id),
    title: String(row.$.title),
    thumb: String(row.$.thumb || ''),
  }));
}
export async function effectiveAccountMappings() {
  const users = await getRepository(User).find({
    select: [
      'id',
      'username',
      'plexUsername',
      'jellyfinUsername',
      'email',
      'plexId',
      'avatar',
    ],
  });
  const policy = JSON.parse(
    fs
      .readFileSync(path.join(appDataPath(), 'social.json'), 'utf8')
      .replace(/^\uFEFF/, '')
  );
  const source = fs
    .readFileSync(policy.mappingScript, 'utf8')
    .match(/const mappings = \[([\s\S]*?)\];/)?.[1];
  if (!source) throw Error('Legacy mappings unavailable');
  const avatars = new Map<number, string>();
  for (const m of source.matchAll(
    /\['(\d+)'\s*,\s*'[^']+'\s*,\s*(\d+)\s*,\s*'([^']+)'\]/g
  ))
    if (users.some((u) => u.id === Number(m[2]) && u.username === m[3]))
      avatars.set(Number(m[2]), m[1]);
  let playback: { users?: Record<string, { plexUserId: string }> } = {};
  try {
    playback = JSON.parse(
      fs
        .readFileSync(
          path.join(appDataPath(), 'playback-profiles.json'),
          'utf8'
        )
        .replace(/^\uFEFF/, '')
    );
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const overrides = readAccountMappings();
  return users.map((user) => {
    const avatar = avatars.get(user.id) || null;
    const player =
      playback.users?.[String(user.id)]?.plexUserId ||
      avatar ||
      (user.plexId ? String(user.plexId) : null);
    const mapping: AccountMapping = overrides.users.find(
      (row) => row.userId === user.id
    ) || {
      userId: user.id,
      avatarPlexId: avatar,
      playbackPlexId: player,
      watchlistPlexId: player,
    };
    return {
      userId: user.id,
      name:
        user.displayName ||
        user.username ||
        user.plexUsername ||
        user.jellyfinUsername ||
        user.email ||
        String(user.id),
      avatar: user.avatar,
      defaultAvatarSource: user.plexId
        ? 'plex'
        : /(?:^|\.)gravatar\.com$/i.test(
              (() => {
                try {
                  return new URL(user.avatar).hostname;
                } catch {
                  return '';
                }
              })()
            )
          ? 'gravatar'
          : 'current',
      defaultAvatarPlexId: user.plexId ? String(user.plexId) : null,
      currentAvatarSource: /(?:^|\.)gravatar\.com$/i.test(
        (() => {
          try {
            return new URL(user.avatar).hostname;
          } catch {
            return '';
          }
        })()
      )
        ? 'gravatar'
        : 'current',
      mapping,
    };
  });
}
