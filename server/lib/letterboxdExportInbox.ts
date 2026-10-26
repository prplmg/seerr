import logger from '@server/logger';
import { appDataPath } from '@server/utils/appDataVolume';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';

export function exportFailure(error: unknown) {
  const e = error as {
    message?: string;
    code?: string;
    cause?: { code?: string };
    response?: { status?: number };
    status?: number;
  };
  const code = String(e?.code || e?.cause?.code || '');
  const status = e?.response?.status || e?.status;
  // Never serialize request objects, response bodies, credentials or archives.
  const message = String(e?.message || error)
    .replace(/https?:\/\/\S+/g, '[URL]')
    .replace(
      /(authorization|cookie|token|api[_-]?key|password)\s*[:=]\s*\S+/gi,
      '$1=[redacted]'
    )
    .slice(0, 600);
  const transient =
    [
      'SQLITE_BUSY',
      'SQLITE_LOCKED',
      'EBUSY',
      'EPERM',
      'EACCES',
      'ETIMEDOUT',
      'ECONNRESET',
      'ECONNREFUSED',
      'EAI_AGAIN',
      'ENETUNREACH',
      'UND_ERR_CONNECT_TIMEOUT',
      'UND_ERR_SOCKET',
    ].includes(code) ||
    status === 429 ||
    (status !== undefined && status >= 500 && status <= 599);
  return { code, status, message, transient };
}

type Delivery = {
  id: string;
  userId: number;
  account: string;
  capturedAt: number;
  encoded: string;
};
const active = new Set<string>();
function filename(instance: string) {
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(instance))
    throw Error('Invalid export instance');
  return path.join(appDataPath(), `letterboxd-export-inbox-${instance}.json`);
}
/** Persist before HTTP acknowledgement. Resolution can take longer than the
 * worker HTTP timeout; polls resume processing after a catalogue restart. */
export function stageExport(instance: string, delivery: Delivery) {
  const file = filename(instance);
  if (fs.existsSync(file)) {
    const previous = JSON.parse(fs.readFileSync(file, 'utf8')) as Delivery;
    if (JSON.stringify(previous) !== JSON.stringify(delivery))
      throw Error('Conflicting export delivery');
    return;
  }
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify(delivery), {
      flag: 'wx',
      mode: 0o600,
    });
    fs.renameSync(temp, file);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}
export function resumeExport(
  instance: string,
  process: (delivery: Delivery) => Promise<void>,
  failed: (id: string, detail?: string) => void
) {
  const file = filename(instance);
  if (!fs.existsSync(file)) return false;
  if (active.has(instance)) return true;
  const delivery = JSON.parse(fs.readFileSync(file, 'utf8')) as Delivery;
  active.add(instance);
  const retryFile = file + '.retry';
  void Promise.resolve()
    .then(async () => {
      let attempts = fs.existsSync(retryFile)
        ? Number(fs.readFileSync(retryFile, 'utf8'))
        : 0;
      if (!Number.isInteger(attempts) || attempts < 0 || attempts >= 4)
        throw Error(
          'Export retry budget exhausted; inspect retained error logs'
        );
      for (;;) {
        fs.writeFileSync(retryFile, String(++attempts));
        try {
          await process(delivery);
          break;
        } catch (error) {
          const detail = exportFailure(error);
          logger.warn('Letterboxd export reconciliation failed', {
            label: 'Letterboxd',
            account: delivery.account,
            jobId: delivery.id,
            attempt: attempts,
            ...detail,
          });
          if (!detail.transient || attempts >= 4) throw error;
          await new Promise((resolve) =>
            setTimeout(resolve, [1000, 3000, 10000][attempts - 1])
          );
        }
      }
      // Cleanup failure must not turn a committed success into a failed job.
      try {
        fs.unlinkSync(file);
        fs.unlinkSync(retryFile);
      } catch (error) {
        logger.warn('Letterboxd export cleanup failed after success', {
          label: 'Letterboxd',
          ...exportFailure(error),
        });
      }
    })
    .catch((error) => {
      const detail = exportFailure(error);
      logger.error('Letterboxd export reconciliation paused', {
        label: 'Letterboxd',
        account: delivery.account,
        jobId: delivery.id,
        ...detail,
      });
      failed(
        delivery.id,
        `${detail.code ? detail.code + ': ' : ''}${detail.message}`
      );
    })
    .finally(() => active.delete(instance));
  return true;
}
