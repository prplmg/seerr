import { getRepository } from '@server/datasource';
import { User } from '@server/entity/User';
import { appDataPath } from '@server/utils/appDataVolume';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { avatarRedirectKind } from './accountAvatarPolicy';
import {
  effectiveAccountMappings,
  plexMappingProfiles,
} from './accountMappingProfiles';
export async function syncMappedAvatars(dryRun = false) {
  const [mappings, profiles, users] = await Promise.all([
    effectiveAccountMappings(),
    plexMappingProfiles(),
    getRepository(User).find(),
  ]);
  const plans: { id: number; oldAvatar: string; avatar: string }[] = [];
  for (const row of mappings) {
    if (row.mapping.avatarSource === 'gravatar') {
      const user = users.find((u) => u.id === row.userId);
      if (!user?.email?.trim())
        throw Error('Gravatar requires an account email');
      const hash = createHash('md5')
        .update(user.email.trim().toLowerCase())
        .digest('hex');
      plans.push({
        id: user.id,
        oldAvatar: user.avatar,
        avatar: `https://gravatar.com/avatar/${hash}?default=mm&size=200`,
      });
      continue;
    }
    if (!row.mapping.avatarPlexId) continue;
    const matches = profiles.filter((p) => p.id === row.mapping.avatarPlexId);
    const user = users.find((u) => u.id === row.userId);
    if (matches.length !== 1 || !user)
      throw Error('Avatar mapping identity missing');
    let avatar = matches[0].thumb;
    // Validate before making a network request; never fetch an arbitrary profile URL.
    const source = new URL(avatar);
    if (
      source.protocol !== 'https:' ||
      source.hostname !== 'plex.tv' ||
      !/^\/users\/[a-f0-9]+\/avatar$/.test(source.pathname)
    )
      throw Error('Invalid avatar source');
    const redirect = await fetch(avatar, {
      redirect: 'manual',
      signal: AbortSignal.timeout(20000),
    });
    const location = redirect.headers.get('location');
    await redirect.body?.cancel();
    if (![301, 302, 303, 307, 308].includes(redirect.status) || !location)
      throw Error('Avatar redirect unavailable');
    const kind = avatarRedirectKind(avatar, location);
    if (kind === 'letter' && user.email?.trim()) {
      const hash = createHash('md5')
        .update(user.email.trim().toLowerCase())
        .digest('hex');
      const probe = await fetch(
        `https://gravatar.com/avatar/${hash}?default=404&size=200`,
        { signal: AbortSignal.timeout(20000) }
      );
      const image =
        probe.ok && probe.headers.get('content-type')?.startsWith('image/');
      await probe.body?.cancel();
      if (image)
        avatar = `https://gravatar.com/avatar/${hash}?default=mm&size=200`;
      else if (probe.status !== 404)
        throw Error('Gravatar availability unknown');
    }
    const check = await fetch(avatar, { signal: AbortSignal.timeout(20000) });
    const valid =
      check.ok && check.headers.get('content-type')?.startsWith('image/');
    await check.body?.cancel();
    if (!valid) throw Error('Avatar unavailable');
    plans.push({ id: user.id, oldAvatar: user.avatar, avatar });
  }
  const changed = plans.filter((row) => row.oldAvatar !== row.avatar);
  if (!dryRun && changed.length) {
    const dir = path.join(appDataPath(), 'mapping-backups');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, `avatars-${Date.now()}.json`),
      JSON.stringify(changed),
      { flag: 'wx', mode: 0o600 }
    );
    await getRepository(User).manager.transaction(async (manager) => {
      for (const row of changed) {
        const result = await manager.update(
          User,
          { id: row.id, avatar: row.oldAvatar },
          {
            avatar: row.avatar,
            // Match the old avatar-only SQL update without touching profile timestamps.
            updatedAt: () => manager.connection.driver.escape('updatedAt'),
          }
        );
        if (result.affected !== 1)
          throw Error('User changed during avatar synchronization');
      }
    });
  }
  return {
    checked: plans.length,
    changed: changed.length,
    dryRun,
    changedUserIds: changed.map((row) => row.id).sort((a, b) => a - b),
  };
}
