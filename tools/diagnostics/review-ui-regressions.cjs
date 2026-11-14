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
