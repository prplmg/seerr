import { appDataPath } from '@server/utils/appDataVolume';
import fs from 'fs';
import path from 'path';

export function validatePlaybackConfig(value: unknown): {
  sourceId: string;
  timezone: string;
} {
  const config = value as { sourceId?: unknown; timezone?: unknown } | null;
  if (
    !config ||
    typeof config.sourceId !== 'string' ||
    !config.sourceId.trim() ||
    config.sourceId !== config.sourceId.trim() ||
    config.sourceId.length > 200 ||
    typeof config.timezone !== 'string' ||
    !config.timezone
  )
    throw Error('Explicit playback source ID and timezone required');
  new Intl.DateTimeFormat('en-US', { timeZone: config.timezone });
  return { sourceId: config.sourceId, timezone: config.timezone };
}

export function readPlaybackConfig() {
  const policy = JSON.parse(
    fs
      .readFileSync(path.join(appDataPath(), 'social.json'), 'utf8')
      .replace(/^\uFEFF/, '')
  );
  return validatePlaybackConfig(policy.letterboxdPlayback);
}
