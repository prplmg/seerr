import type { MovieChoice } from '@server/interfaces/api/catalogueLists';
export type DraftRow = { id: number; query: string; movie?: MovieChoice };
export type ListDraft = {
  version: 1;
  updatedAt: number;
  title: string;
  description: string;
  text: string;
  mode: 'choose' | 'paste' | 'review';
  visibility: 'public' | 'private';
  rows: DraftRow[];
  revision?: number;
};
export const listDraftKey = (userId: number, listId?: string) =>
  `catalogue-list-draft:v1:${userId}:${listId || 'new'}`;
export function parseListDraft(
  raw: string | null,
  now = Date.now()
): ListDraft | undefined {
  try {
    if (!raw || raw.length > 400000) return;
    const d = JSON.parse(raw);
    if (
      d.version !== 1 ||
      !Number.isFinite(d.updatedAt) ||
      now - d.updatedAt > 30 * 86400000 ||
      typeof d.title !== 'string' ||
      d.title.length > 200 ||
      typeof d.description !== 'string' ||
      d.description.length > 5000 ||
      typeof d.text !== 'string' ||
      d.text.length > 60000 ||
      !['choose', 'paste', 'review'].includes(d.mode) ||
      !['public', 'private'].includes(d.visibility) ||
      !Array.isArray(d.rows) ||
      d.rows.length > 200 ||
      d.rows.some(
        (r: DraftRow) =>
          !r ||
          !Number.isSafeInteger(r.id) ||
          typeof r.query !== 'string' ||
          r.query.length > 300 ||
          (r.movie &&
            (!Number.isSafeInteger(r.movie.id) ||
              r.movie.id < 1 ||
              typeof r.movie.title !== 'string' ||
              typeof r.movie.year !== 'string' ||
              (r.movie.poster !== null &&
                (typeof r.movie.poster !== 'string' ||
                  !/^\/[\w.-]+$/.test(r.movie.poster)))))
      ) ||
      new Set(d.rows.map((r: DraftRow) => r.id)).size !== d.rows.length
    )
      return;
    return d;
  } catch {
    return;
  }
}
