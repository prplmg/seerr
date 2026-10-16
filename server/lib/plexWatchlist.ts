import PlexTvAPI from '@server/api/plextv';
import { getRepository } from '@server/datasource';
import { User } from '@server/entity/User';
import { appDataPath } from '@server/utils/appDataVolume';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { parseStringPromise } from 'xml2js';

const headers = {
  'X-Plex-Client-Identifier': 'multimeldia-watchlist',
  'X-Plex-Product': 'Multimeldia',
  Accept: 'application/json',
};
const profiles = new Map<string, { token: string; until: number }>();

// Playback sharing controls watchlists, not attribution of watched history.
export async function plexWatchlistToken(userId: number): Promise<string> {
  const users = await getRepository(User).find();
  const user = users.find((u) => u.id === userId);
  if (!user) throw Error('User not found');
  let plexId: string | undefined;
  const preferencesPath = path.join(appDataPath(), 'playback-profiles.json');
  if (fs.existsSync(preferencesPath)) {
    const preferences = JSON.parse(
      fs.readFileSync(preferencesPath, 'utf8').replace(/^\uFEFF/, '')
    );
    if (preferences.version === 1)
      plexId = preferences.users?.[String(userId)]?.plexUserId;
  }
  if (!plexId) {
    const policy = JSON.parse(
      fs
        .readFileSync(path.join(appDataPath(), 'social.json'), 'utf8')
        .replace(/^\uFEFF/, '')
    );
    const block = fs
      .readFileSync(policy.mappingScript, 'utf8')
      .match(/const mappings = \[([\s\S]*?)\];/)?.[1];
    for (const m of (block ?? '').matchAll(
      /\['(\d+)'\s*,\s*'[^']+'\s*,\s*(\d+)\s*,\s*'([^']+)'\]/g
    )) {
      if (Number(m[2]) === userId && user.username === m[3]) plexId = m[1];
    }
  }
  if (!plexId) {
    if (!user.plexToken) throw Error('No linked Plex account');
    return user.plexToken;
  }
  if (!/^\d+$/.test(plexId)) throw Error('Invalid linked Plex profile');
  if (String(user.plexId) === plexId && user.plexToken) return user.plexToken;
  const cached = profiles.get(plexId);
  if (cached && cached.until > Date.now()) return cached.token;
  const owner = users.find((u) => u.id === 1);
  if (!owner?.plexToken) throw Error('Plex profile authentication unavailable');
  const response = await axios.post(
    `https://plex.tv/api/home/users/${plexId}/switch`,
    null,
    {
      headers: {
        ...headers,
        Accept: 'application/xml',
        'X-Plex-Token': owner.plexToken,
      },
      timeout: 8000,
      maxRedirects: 0,
    }
  );
  const parsed = await parseStringPromise(response.data);
  if (
    String(parsed.user?.$?.id) !== plexId ||
    !parsed.user?.$?.authenticationToken
  )
    throw Error('Plex profile identity mismatch');
  const token = parsed.user.$.authenticationToken as string;
  profiles.set(plexId, { token, until: Date.now() + 10 * 60 * 1000 });
  return token;
}

export async function plexProfileWatchlist(userId: number, page: number) {
  const token = await plexWatchlistToken(userId);
  const list = await new PlexTvAPI(token).getWatchlist({
    offset: (page - 1) * 20,
    strict: true,
  });
  return {
    page,
    totalPages: Math.ceil(list.totalSize / 20),
    totalResults: list.totalSize,
    results: list.items.map((item) => ({
      id: item.tmdbId,
      ratingKey: item.ratingKey,
      title: item.title,
      mediaType: item.type === 'show' ? ('tv' as const) : ('movie' as const),
      tmdbId: item.tmdbId,
    })),
  };
}

export async function plexBookmark(
  userId: number,
  type: 'movie' | 'tv',
  id: number,
  desired?: boolean
) {
  const token = await plexWatchlistToken(userId);
  const options = {
    headers: { ...headers, 'X-Plex-Token': token },
    timeout: 8000,
    maxRedirects: 0,
  };
  const result = await axios.get(
    'https://metadata.provider.plex.tv/library/metadata/matches',
    {
      ...options,
      params: { guid: `tmdb://${id}`, type: type === 'movie' ? 1 : 2 },
    }
  );
  const matches = result.data.MediaContainer?.Metadata ?? [];
  if (
    matches.length !== 1 ||
    matches[0].type !== (type === 'movie' ? 'movie' : 'show')
  )
    throw Error('No unambiguous Plex match');
  const key = String(matches[0].guid ?? '').match(
    /^plex:\/\/(?:movie|show)\/([a-f0-9]+)$/
  )?.[1];
  if (!key) throw Error('Missing Plex identity');
  const state = async () => {
    const r = await axios.get(
      `https://metadata.provider.plex.tv/library/metadata/${key}/userState`,
      options
    );
    const raw = r.data.MediaContainer?.UserState;
    const item = Array.isArray(raw) ? raw[0] : raw;
    if (!item) throw Error('Plex watchlist state unavailable');
    return !!item.watchlistedAt;
  };
  let added = await state();
  if (desired !== undefined && desired !== added) {
    await axios.put(
      `https://discover.provider.plex.tv/actions/${desired ? 'addToWatchlist' : 'removeFromWatchlist'}`,
      null,
      { ...options, params: { ratingKey: key } }
    );
    added = await state();
    if (added !== desired) throw Error('Plex did not confirm watchlist change');
  }
  return { added };
}
