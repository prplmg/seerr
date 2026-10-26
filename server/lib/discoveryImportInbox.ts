import { getRepository } from '@server/datasource';
import { LetterboxdAccount } from '@server/entity/MovieReview';
import logger from '@server/logger';
import { appDataPath } from '@server/utils/appDataVolume';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import {
  importDiscoveryExport,
  refreshDiscoveryLists,
} from './discoveryListImport';
import { readExportSnapshot } from './letterboxdExportSnapshot';
type Delivery = {
  userId: number;
  account: string;
  encoded: string;
  capturedAt: number;
};
const directory = () => path.join(appDataPath(), 'discovery-import-inbox');
const file = (id: number) => path.join(directory(), `${id}.json`);
const running = new Set<number>();
const waiting = new Set<number>();
// Durable handoff: list metadata/network lookups must not occupy the core
// reconciliation callback or make the browser wait for an unrelated list.
export async function enqueueDiscoveryExport(delivery: Delivery) {
  if (
    !Number.isSafeInteger(delivery.userId) ||
    delivery.userId < 1 ||
    !Number.isFinite(delivery.capturedAt)
  )
    throw Error('Invalid discovery delivery');
  await readExportSnapshot(delivery.encoded, delivery.account);
  fs.mkdirSync(directory(), { recursive: true, mode: 0o700 });
  const target = file(delivery.userId);
  if (
    fs.existsSync(target) &&
    JSON.parse(fs.readFileSync(target, 'utf8')).capturedAt >=
      delivery.capturedAt
  )
    return;
  const temp = target + '.' + randomUUID() + '.tmp';
  try {
    fs.writeFileSync(temp, JSON.stringify(delivery), {
      flag: 'wx',
      mode: 0o600,
    });
    fs.renameSync(temp, target);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
  setImmediate(() => {
    void processDiscoveryImport(delivery.userId);
  });
}
export async function processDiscoveryImport(userId: number) {
  if (running.has(userId) || !fs.existsSync(file(userId))) return;
  if (running.size) {
    waiting.add(userId);
    return;
  }
  running.add(userId);
  let stamp = 0;
  try {
    const delivery = JSON.parse(
      fs.readFileSync(file(userId), 'utf8')
    ) as Delivery;
    stamp = delivery.capturedAt;
    const account = await getRepository(LetterboxdAccount).findOne({
      where: { userId },
    });
    if (!account?.enabled || account.username !== delivery.account) return;
    logger.info('Owned list import started', {
      label: 'Discovery lists',
      userId,
    });
    await importDiscoveryExport(
      userId,
      delivery.account,
      delivery.encoded,
      stamp
    );
    if (
      fs.existsSync(file(userId)) &&
      JSON.parse(fs.readFileSync(file(userId), 'utf8')).capturedAt === stamp
    )
      fs.unlinkSync(file(userId));
    logger.info('Owned list import completed', {
      label: 'Discovery lists',
      userId,
    });
    await refreshDiscoveryLists();
  } catch {
    logger.warn('Owned list import retained for the next scheduled retry', {
      label: 'Discovery lists',
      userId,
    });
  } finally {
    running.delete(userId);
    const next = waiting.values().next().value;
    if (next !== undefined) {
      waiting.delete(next);
      setImmediate(() => {
        void processDiscoveryImport(next);
      });
    }
    if (fs.existsSync(file(userId))) {
      try {
        if (
          JSON.parse(fs.readFileSync(file(userId), 'utf8')).capturedAt > stamp
        )
          setImmediate(() => {
            void processDiscoveryImport(userId);
          });
      } catch {
        /* Retain malformed delivery for inspection. */
      }
    }
  }
}
export async function resumeDiscoveryImports() {
  if (!fs.existsSync(directory())) return;
  for (const name of fs
    .readdirSync(directory())
    .filter((n) => /^[1-9]\d*\.json$/.test(n))
    .slice(0, 100))
    await processDiscoveryImport(Number(name.slice(0, -5)));
}
