export const catalogueOrigin = 'https://catalogue.prpl.com.mx';
export const listSharePath = (id: string) =>
  `/share/lists/${encodeURIComponent(id)}`;
// Login return targets are deliberately limited to created-list detail pages.
export function listLoginDestination(value: unknown): string {
  return typeof value === 'string' &&
    /^\/lists\/catalogue-[a-f0-9-]{36}$/.test(value)
    ? value
    : '/';
}
