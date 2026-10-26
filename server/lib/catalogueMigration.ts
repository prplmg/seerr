import { appDataPath } from '@server/utils/appDataVolume';
import fs from 'fs';
import path from 'path';

// Cutover is an operational step after live verification, never inferred from a build.
export function avatarMigrationActive(): boolean {
  try {
    const state = JSON.parse(
      fs.readFileSync(
        path.join(appDataPath(), 'catalogue-job-migration.json'),
        'utf8'
      )
    );
    return (
      state.version === 1 &&
      state.avatarVerified === true &&
      state.legacyAvatarTaskDisabled === true
    );
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

export function watchlistRefreshActive(): boolean {
  try {
    const state = JSON.parse(fs.readFileSync(path.join(appDataPath(), 'catalogue-job-migration.json'), 'utf8'));
    return state.version === 1 && state.watchlistVerified === true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}
