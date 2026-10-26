import { parseDocument } from 'htmlparser2';
type Node = {
  type: string;
  name?: string;
  attribs?: Record<string, string>;
  data?: string;
  children?: Node[];
  parent?: Node | null;
};
function descendants(root: Node) {
  const result: Node[] = [],
    pending = [root];
  while (pending.length) {
    const n = pending.pop()!;
    result.push(n);
    pending.push(...(n.children || []).slice().reverse());
  }
  return result;
}
const classes = (node: Node, name: string) =>
  (node.attribs?.class || '').split(/\s+/).includes(name);
function text(node: Node): string {
  if (['script', 'style'].includes(node.name || '')) return '';
  if (node.name === 'br') return '\n';
  return (
    (node.data || '') +
    (node.children || []).map(text).join('') +
    (node.name === 'p' ? '\n\n' : '')
  );
}
export function publicListExportLink(html: string, canonical: string) {
  const nodes = descendants(parseDocument(html));
  return nodes.some(
    (n) =>
      n.name === 'a' &&
      n.attribs?.href &&
      new URL(n.attribs.href, canonical).href === canonical + 'export/'
  )
    ? canonical + 'export/'
    : undefined;
}
// Strict public-page reader: a matching canonical identity, an explicit total,
// recognized poster container and complete pagination are mandatory evidence.
export function parsePublicListPage(
  html: string,
  canonical: string,
  current = canonical
) {
  if (
    Buffer.byteLength(html) > 2 * 1024 * 1024 ||
    /cf-chl-|Just a moment|This list is private/i.test(html)
  )
    throw Error('Public list unavailable');
  const nodes = descendants(parseDocument(html));
  const meta = (key: string) =>
    nodes.find(
      (n) =>
        n.name === 'meta' &&
        (n.attribs?.property === key || n.attribs?.name === key)
    )?.attribs?.content || '';
  const identity =
    nodes.find((n) => n.name === 'link' && n.attribs?.rel === 'canonical')
      ?.attribs?.href || meta('og:url');
  if (identity !== canonical && identity !== current)
    throw Error('List page identity mismatch');
  const description = meta('description') || meta('og:description');
  const count = description.match(/\b(?:a list of\s+)?([\d,]+) films?\b/i)?.[1];
  if (count === undefined) throw Error('Missing list count');
  const total = Number(count.replace(/,/g, ''));
  if (!Number.isSafeInteger(total) || total < 0 || total > 10000)
    throw Error('Invalid list count');
  const heading = nodes.find(
    (n) =>
      n.name === 'h1' && (classes(n, 'list-title') || classes(n, 'title-1'))
  );
  const title = (heading ? text(heading) : meta('og:title'))
    .trim()
    .slice(0, 500);
  if (!title) throw Error('Missing list title');
  const body = nodes.find(
    (n) =>
      classes(n, 'list-description') ||
      (classes(n, 'body-text') &&
        n.attribs?.['data-full-text-url'] === '#list-notes')
  );
  const containers = nodes.filter(
    (n) => classes(n, 'poster-list') || classes(n, 'grid')
  );
  const found = new Map<
    string,
    { title: string; year: string; url: string; note: string }
  >();
  for (const container of containers)
    for (const node of descendants(container)) {
      const a = node.attribs || {};
      const slug =
        a['data-film-slug'] ||
        a['data-item-slug'] ||
        a['data-target-link']?.match(
          /^\/film\/([a-z0-9-]+|film:[1-9][0-9]*)\/$/i
        )?.[1];
      if (!slug) continue;
      if (!/^(?:[a-z0-9-]+|film:[1-9][0-9]*)$/i.test(slug))
        throw Error('Invalid film slug');
      const img = descendants(node).find((n) => n.name === 'img');
      let item = node;
      for (
        let i = 0;
        i < 10 && item.parent && item !== container && item.name !== 'li';
        i++
      )
        item = item.parent;
      const note = descendants(item).find((n) => classes(n, 'body-text'));
      const row = {
        url: `https://letterboxd.com/film/${slug}/`,
        title:
          a['data-film-name'] ||
          a['data-item-name'] ||
          img?.attribs?.alt ||
          slug,
        year: '',
        note: note ? text(note).trim().slice(0, 20000) : '',
      };
      if (!found.has(slug)) found.set(slug, row);
    }
  const nexts = [
    ...new Set(
      nodes
        .filter(
          (n) =>
            n.name === 'a' && (n.attribs?.rel === 'next' || classes(n, 'next'))
        )
        .map((n) => new URL(n.attribs?.href || '', current).href)
    ),
  ];
  if (nexts.length > 1) throw Error('Ambiguous pagination');
  const next = nexts[0] || null;
  if (next) {
    const n = new URL(next),
      root = new URL(canonical);
    if (
      n.origin !== root.origin ||
      n.search ||
      n.hash ||
      !n.pathname.startsWith(root.pathname) ||
      !/^page\/[1-9]\d*\/$/.test(n.pathname.slice(root.pathname.length))
    )
      throw Error('Invalid pagination');
  }
  if (
    !found.size &&
    (total !== 0 ||
      next ||
      !nodes.some((n) => classes(n, 'empty-text') && /no films/i.test(text(n))))
  )
    throw Error('Unrecognized or incomplete list');
  return {
    title,
    description: body ? text(body).trim().slice(0, 20000) : '',
    items: [...found.values()],
    total,
    next,
  };
}
