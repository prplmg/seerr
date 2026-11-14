const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
function load(file, requireMock) {
  const exports = {};
  new Function(
    'require',
    'exports',
    ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }).outputText
  )(requireMock, exports);
  return exports;
}
test('keyboard viewport follows resize and pan; closing restores page position and listeners', () => {
  let effect, style, cleanup;
  const listeners = new Map();
  const visible = {
    height: 430,
    offsetTop: 35,
    addEventListener: (k, f) => listeners.set('v' + k, f),
    removeEventListener: (k) => listeners.delete('v' + k),
  };
  const body = { style: { position: '', top: '', width: '' } };
  let restored;
  global.document = { body };
  global.window = {
    scrollY: 725,
    innerHeight: 800,
    visualViewport: visible,
    addEventListener: (k, f) => listeners.set(k, f),
    removeEventListener: (k) => listeners.delete(k),
    scrollTo: (x) => (restored = x),
  };
  try {
    const { useReviewDialogViewport } = load(
      'src/components/Reviews/useReviewDialogViewport.ts',
      () => ({
        useState: () => [undefined, (x) => (style = x)],
        useEffect: (f) => (effect = f),
      })
    );
    useReviewDialogViewport(true);
    cleanup = effect();
    assert.equal(body.style.position, 'fixed');
    assert.equal(body.style.top, '-725px');
    assert.deepEqual(style, { top: 35, height: 430 });
    visible.height = 300;
    visible.offsetTop = 90;
    listeners.get('vresize')();
    assert.deepEqual(style, { top: 90, height: 300 });
    cleanup();
    assert.deepEqual(body.style, { position: '', top: '', width: '' });
    assert.equal(restored.top, 725);
    assert.equal(listeners.size, 0);
  } finally {
    delete global.document;
    delete global.window;
  }
});
test('profile feed scopes author and excludes blank reviews without a date cutoff; validates ID', async () => {
  const handlers = new Map();
  const clauses = [];
  let paged;
  const q = new Proxy(
    {},
    {
      get: (_, key) =>
        key === 'getManyAndCount'
          ? async () => [[], 0]
          : (...args) => {
              if (['where', 'andWhere'].includes(key)) clauses.push(args);
              if (key === 'take') paged = args[0];
              return q;
            },
    }
  );
  const router = new Proxy(
    {},
    {
      get:
        (_, key) =>
        (route, ...f) => {
          if (key === 'get') handlers.set(route, f.at(-1));
          return router;
        },
    }
  );
  const noop = () => {};
  load('server/routes/reviews.ts', (name) => {
    if (name === 'express') return { Router: () => router };
    if (name === 'express-rate-limit') return () => noop;
    if (name === '@server/datasource')
      return { getRepository: () => ({ createQueryBuilder: () => q }) };
    if (name === '@server/lib/reviewChronology')
      return { reviewActivityDate: 'review.watchedDate' };
    if (name === '@server/lib/letterboxdExportPolicy')
      return { currentSyncReceipts: async () => [] };
    if (name === '@server/lib/letterboxdFilmEvidence')
      return { readFilmEvidence: () => ({}) };
    if (name === '@server/lib/letterboxdWriteQueue')
      return { readWriteState: () => ({}) };
    return new Proxy(
      { __esModule: true },
      { get: (_, k) => (k === '__esModule' ? true : noop) }
    );
  });
  let status, payload;
  const res = { json: (x) => (payload = x), sendStatus: (x) => (status = x) };
  await handlers.get('/')({ query: { userId: '42' }, user: { id: 1 } }, res);
  assert.equal(status, undefined);
  assert.equal(payload.total, 0);
  assert.equal(paged, 20);
  assert.ok(
    clauses.some(
      ([sql, params]) =>
        sql.includes('review.userId') && params.profileUserId === 42
    )
  );
  assert.ok(clauses.some(([sql]) => sql.includes("review.text <> ''")));
  assert.ok(!clauses.some(([sql]) => sql.includes(':since')));
  await handlers.get('/')({ query: { userId: 'bad' } }, res);
  assert.equal(status, 400);
  clauses.length = 0;
  status = undefined;
  await handlers.get('/')({ query: { days: '28' }, user: { id: 1 } }, res);
  assert.equal(status, undefined);
  assert.ok(clauses.some(([sql]) => sql.includes(':since')));
});

test('episode modal does not dismiss underneath a portaled comments dialog', () => {
  let outside,
    closed = 0,
    childOpen = true;
  global.document = { body: {}, querySelector: () => (childOpen ? {} : null) };
  const react = {
    forwardRef: (f) => f,
    useRef: (value) => ({ current: value }),
    useEffect: () => {},
    Fragment: 'fragment',
  };
  try {
    const { default: Modal } = load(
      'src/components/Common/Modal/index.tsx',
      (name) => {
        if (name === 'react') return react;
        if (name === 'react/jsx-runtime')
          return { jsx: () => null, jsxs: () => null };
        if (name === 'react-dom') return { createPortal: () => null };
        if (name === 'react-intl')
          return { useIntl: () => ({ formatMessage: () => 'Close' }) };
        if (name === '@app/hooks/useClickOutside')
          return (_, callback) => {
            outside = callback;
          };
        if (name === '@app/hooks/useLockBodyScroll')
          return { useLockBodyScroll: () => {} };
        if (name === '@headlessui/react')
          return { Transition: { Child: 'child' } };
        return {};
      }
    );
    Modal({ onCancel: () => closed++ }, null);
    outside();
    assert.equal(closed, 0);
    childOpen = false;
    outside();
    assert.equal(closed, 1);
  } finally {
    delete global.document;
  }
});

test('review dates stay calendar-only; comments show elapsed time; two-week cutoff', () => {
  const { reviewTime } = load('src/utils/reviewTime.ts', require);
  const now = new Date(2026, 10, 13, 19, 30);
  assert.equal(reviewTime('2026-11-13', 'review', 'en', now).label, 'today');
  assert.equal(
    reviewTime('2026-11-12', 'review', 'en', now).label,
    'yesterday'
  );
  assert.equal(
    reviewTime('2026-11-05', 'review', 'en', now).label,
    'last week'
  );
  assert.ok(
    !reviewTime('2026-10-30', 'review', 'en', now).label.includes('ago')
  );
  assert.equal(
    reviewTime(new Date(now - 180000).toISOString(), 'comment', 'en', now)
      .label,
    '3 minutes ago'
  );
  assert.equal(reviewTime('2026-11-13', 'review', 'es', now).label, 'hoy');
  assert.ok(!reviewTime('2026-11-13', 'review', 'en', now).exact.includes(':'));
  assert.ok(
    reviewTime(now.toISOString(), 'comment', 'en', now).exact.includes(':')
  );
});

test('author replies notify prior commenters once, exclude actor; reactions remain author-only', async () => {
  const sent = [];
  let ids = [];
  class MovieReview {}
  class ReviewComment {}
  class User {}
  const author = { id: 1, displayName: 'Author' };
  let failMetadata = false;
  const mod = load('server/lib/reviewSocialNotification.ts', (name) => {
    if (name === '@server/api/themoviedb')
      return class {
        async getTvShow() {
          if (failMetadata) throw Error('offline');
          return { name: 'Abbott Elementary' };
        }
      };
    if (name === '@server/entity/MovieReview') return { MovieReview };
    if (name === '@server/entity/ReviewInteraction') return { ReviewComment };
    if (name === '@server/entity/User') return { User };
    if (name === 'typeorm')
      return {
        In: (x) => {
          ids = x;
          return x;
        },
      };
    if (name === '@server/datasource')
      return {
        getRepository: (entity) =>
          entity === MovieReview
            ? {
                findOne: async () => ({
                  id: 'r',
                  userId: 1,
                  user: author,
                  mediaType: 'tv',
                  tmdbId: 9,
                  seasonNumber: 2,
                  episodeNumber: 3,
                }),
              }
            : entity === User
              ? {
                  find: async () =>
                    ids.map((id) => ({ id, displayName: 'User' + id })),
                }
              : {
                  createQueryBuilder: () => {
                    const q = {
                      select: () => q,
                      where: () => q,
                      distinct: () => q,
                      getRawMany: async () => [
                        { userId: 2 },
                        { userId: 2 },
                        { userId: 1 },
                        { userId: 3 },
                      ],
                    };
                    return q;
                  },
                },
      };
    if (name.includes('/agents/'))
      return class {
        shouldSend() {
          return true;
        }
        async send(type, p) {
          sent.push(p);
        }
      };
    if (name === '@server/lib/notifications')
      return { Notification: { SOCIAL_INTERACTIONS: 8192 } };
    if (name === '@server/logger') return { error: () => {} };
    throw Error(name);
  });
  await mod.notifyReviewAuthor('r', author);
  assert.deepEqual(
    sent.map((p) => p.notifyUser.id),
    [2, 2, 3, 3]
  );
  assert.ok(sent.every((p) => p.reviewUrl.includes('reviewEpisode=3')));
  assert.ok(
    sent.every(
      (p) =>
        p.message ===
        'Author commented on their Abbott Elementary S02E03 review.'
    )
  );
  sent.length = 0;
  await mod.notifyReviewAuthor('r', { id: 2, displayName: 'Other' });
  assert.equal(
    sent[0].message,
    'Other commented on your Abbott Elementary S02E03 review.'
  );
  assert.equal(
    sent[2].message,
    'Other commented on Author’s Abbott Elementary S02E03 review.'
  );
  failMetadata = true;
  sent.length = 0;
  await mod.notifyReviewAuthor('r', author);
  assert.equal(sent[0].message, 'Author commented on their review.');
  sent.length = 0;
  await mod.notifyReviewAuthor('r', { id: 2, displayName: 'Other' }, '❤');
  assert.deepEqual(
    sent.map((p) => p.notifyUser.id),
    [1, 1]
  );
});

test('keyboard resize reveals composer inside sheet; manual scrolling is not overridden', () => {
  let effect;
  const events = new Map(),
    frames = new Map();
  let next = 0;
  class Field {
    matches() {
      return true;
    }
    getBoundingClientRect() {
      return { top: 500, bottom: 650, height: 150 };
    }
  }
  const container = {
    scrollTop: 0,
    contains: () => true,
    getBoundingClientRect: () => ({ top: 100, bottom: 400 }),
    addEventListener: (k, f) => events.set(k, f),
    removeEventListener: (k) => events.delete(k),
  };
  global.HTMLElement = Field;
  global.document = { body: { style: {} }, activeElement: new Field() };
  global.requestAnimationFrame = (f) => {
    frames.set(++next, f);
    return next;
  };
  global.cancelAnimationFrame = (id) => frames.delete(id);
  global.window = {
    scrollY: 40,
    innerHeight: 800,
    scrollTo: () => {},
    addEventListener: (k, f) => events.set(k, f),
    removeEventListener: (k) => events.delete(k),
    visualViewport: {
      height: 400,
      offsetTop: 0,
      addEventListener: (k, f) => events.set('v' + k, f),
      removeEventListener: (k) => events.delete('v' + k),
    },
  };
  const flush = () => {
    while (frames.size) {
      const batch = [...frames.values()];
      frames.clear();
      batch.forEach((f) => f());
    }
  };
  try {
    const { useReviewDialogViewport } = load(
      'src/components/Reviews/useReviewDialogViewport.ts',
      () => ({
        useEffect: (f) => (effect = f),
        useState: () => [undefined, () => {}],
      })
    );
    useReviewDialogViewport(true, { current: container });
    const cleanup = effect();
    events.get('vresize')();
    flush();
    assert.equal(container.scrollTop, 262);
    container.scrollTop = 0;
    events.get('vscroll')();
    flush();
    assert.equal(container.scrollTop, 0);
    events.get('focusin')();
    cleanup();
    assert.equal(frames.size, 0);
    assert.equal(events.size, 0);
  } finally {
    for (const k of [
      'window',
      'document',
      'HTMLElement',
      'requestAnimationFrame',
      'cancelAnimationFrame',
    ])
      delete global[k];
  }
});
