import { rssReviews, type ImportedReview } from './letterboxdImport';

export type HistoryRow = {
  media_type?: string;
  grandparent_rating_key?: unknown;
  parent_media_index?: unknown;
  media_index?: unknown;
  row_id?: unknown;
  reference_id?: unknown;
  stopped: number;
  plexId: string;
  key: string;
  type: string;
  stamp: number;
  user_id: string;
  rating_key: string;
  machine_id?: string;
  started: number;
  watched_status: number;
  season?: number;
  episode?: number;
};
export type BackgroundTask =
  | { kind: 'history' }
  | { kind: 'rss'; username: string }
  | { kind: 'json'; text: string; silent?: boolean };
export type BackgroundResult<T extends BackgroundTask> = T extends {
  kind: 'history';
}
  ? HistoryRow[]
  : T extends { kind: 'rss' }
    ? ImportedReview[]
    : unknown;

export async function executeBackgroundTask(
  task: BackgroundTask,
  read: (page: number) => Promise<string>
) {
  if (task.kind === 'json') {
    try {
      return JSON.parse(task.text);
    } catch (error) {
      if (task.silent) return task.text;
      throw error;
    }
  }
  if (task.kind === 'rss') return rssReviews(await read(0), task.username);
  if (task.kind !== 'history') throw Error('Unsupported background task');
  const rows: HistoryRow[] = [];
  for (let page = 0; page < 40; page++) {
    const payload = JSON.parse(await read(page)).response;
    if (payload?.result !== 'success' || !Array.isArray(payload.data?.data))
      throw Error('History unavailable');
    for (const value of payload.data.data) {
      const row = value && typeof value === 'object' ? value : {};
      // Keep unsupported/malformed rows as continuity barriers; consumers filter
      // media only after attribution reconciliation of the global snapshot.
      const stamp = Number(row.stopped || row.date || row.started);
      const key = String(
        row.media_type === 'episode'
          ? row.grandparent_rating_key
          : row.rating_key
      );
      rows.push({
        media_type: row.media_type,
        grandparent_rating_key: row.grandparent_rating_key,
        parent_media_index: row.parent_media_index,
        media_index: row.media_index,
        row_id: row.row_id,
        reference_id: row.reference_id,
        stopped: Number(row.stopped),
        plexId: String(row.user_id),
        key,
        type:
          row.media_type === 'episode'
            ? 'tv'
            : row.media_type === 'movie'
              ? 'movie'
              : 'unsupported',
        stamp,
        user_id: String(row.user_id),
        rating_key: String(row.rating_key),
        machine_id: row.machine_id,
        started: Number(row.started),
        watched_status: Number(row.watched_status),
        season:
          row.media_type === 'episode'
            ? Number(row.parent_media_index)
            : undefined,
        episode:
          row.media_type === 'episode' ? Number(row.media_index) : undefined,
      });
    }
    if (
      page * 500 + payload.data.data.length >=
        Number(payload.data.recordsFiltered) ||
      payload.data.data.length < 500
    )
      return rows;
  }
  throw Error('History exceeds safe paging limit');
}
