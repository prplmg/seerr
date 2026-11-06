const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const jsx = (type, props) => ({ type, props });
let membershipResponse,
  membershipError,
  viewport = true;
let effects = [],
  query = {},
  response,
  error,
  calls = [],
  requests = [],
  retries = 0;
let discovery = { enabled: true, loading: false, href: (url) => url };
const events = new Map();
const router = {
  pathname: '/lists/explore',
  isReady: true,
  get query() {
    return query;
  },
  get asPath() {
    return '/lists/explore?' + new URLSearchParams(query);
  },
  push: (...args) => calls.push(['push', ...args]),
  replace: (...args) => calls.push(['replace', ...args]),
  events: {
    on: (name, fn) => events.set(name, fn),
    off: (name) => events.delete(name),
  },
};
const category = {
  id: 'one',
  title: { en: 'Curated One' },
  description: { en: 'Description' },
  cover: { type: 'movie', tmdbId: 1 },
};
const mocks = {
  react: {
    useState: (v) => [v, () => {}],
    useEffect: (fn) => effects.push(fn),
    useCallback: (fn) => fn,
  },
  'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'fragment' },
  'next/router': { useRouter: () => router },
  'next/link': 'link',
  '@app/hooks/useUser': { useUser: () => ({ user: { id: 7 } }) },
  '@app/hooks/useDiscovery': () => discovery,
  '@app/components/WatchParty/messages': { usePartyText: () => (en) => en },
  'react-intl': { useIntl: () => ({ locale: 'en' }) },
  'react-intersection-observer': {
    useInView: () => ({ inView: viewport, ref() {} }),
  },
  swr: (key) => {
    requests.push(key);
    if (Array.isArray(key) && key[0].includes('/media/'))
      return {
        data: membershipResponse,
        error: membershipError,
        mutate: () => retries++,
      };
    return typeof key === 'string' && key.startsWith('/api/v1/curated')
      ? { data: { day: 'today', results: [category] } }
      : {
          data: key ? response : undefined,
          error: key ? error : undefined,
          mutate: () => retries++,
        };
  },
};
function load(file) {
  const exports = {};
  new Function(
    'require',
    'exports',
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
    }).outputText
  )(
    (name) =>
      name in mocks
        ? mocks[name]
        : new Proxy(function Stub() {}, {
            get: (_, key) =>
              key === '__esModule' ? false : function Stub() {},
          }),
    exports
  );
  return exports;
}
const library = load('src/components/Discover/ListLibrary.tsx');
mocks['@app/components/Discover/ListLibrary'] = library;
const curated = load('src/components/Discover/Curated/index.tsx');
function nodes(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap(nodes);
  return typeof value === 'object'
    ? [value, ...nodes(value.props?.children)]
    : [];
}
function renderExplore() {
  const element = library.ExploreListsPage().props.children;
  return element.type(element.props);
}
function ids(tree) {
  return (
    nodes(tree)
      .find((n) => n.props?.lists)
      ?.props.lists.map((l) => l.id) || []
  );
}
const lists = [
  { id: 'curated-one', source: 'curated', title: 'Space', creator: 'Team' },
  { id: 'lb', source: 'letterboxd', title: 'Space', creator: 'Friend' },
  {
    id: 'public',
    source: 'catalogue',
    title: 'Space',
    visibility: 'public',
    owned: false,
  },
  { id: 'own', source: 'catalogue', visibility: 'public', owned: true },
  { id: 'private', source: 'catalogue', visibility: 'private', owned: false },
  { id: 'unknown', source: 'catalogue', visibility: 'unknown', owned: false },
  {
    id: 'virtual',
    source: 'catalogue',
    visibility: 'public',
    owned: false,
    virtual: true,
  },
].map((list) => ({ title: '', creator: '', description: '', ...list }));
response = { results: lists };
for (const [source, expected] of [
  ['curated', ['curated-one']],
  ['letterboxd', ['lb']],
  ['public', ['public']],
]) {
  query = { source, q: 'SPACE', previewUserId: '12' };
  assert.deepEqual(ids(renderExplore()), expected);
}
query = { source: 'invalid' };
assert.equal(ids(renderExplore()).length, lists.length);
query = { source: 'curated', q: 'not found' };
let tree = renderExplore();
assert.deepEqual(ids(tree), []);
assert(
  nodes(tree).some((n) => n.type === 'option' && n.props.value === 'public'),
  'category availability is independent of search'
);
query = { source: 'curated', q: 'Space', previewUserId: '12' };
tree = renderExplore();
nodes(tree)
  .find((n) => n.type === 'select')
  .props.onChange({ target: { value: 'letterboxd' } });
assert.deepEqual(calls.pop(), [
  'push',
  { pathname: router.pathname, query: { ...query, source: 'letterboxd' } },
  undefined,
  { shallow: true, scroll: false },
]);
nodes(tree)
  .find((n) => n.type === 'input')
  .props.onChange({ target: { value: 'Friend' } });
assert.deepEqual(calls.pop(), [
  'replace',
  { pathname: router.pathname, query: { ...query, q: 'Friend' } },
  undefined,
  { shallow: true, scroll: false },
]);
response = { results: lists.filter((l) => l.id !== 'public') };
assert(
  !nodes(renderExplore()).some(
    (n) => n.type === 'option' && n.props.value === 'public'
  )
);
query = { source: 'public' };
assert.deepEqual(
  ids(renderExplore()),
  [],
  'unavailable deep link must not show a different category'
);
assert(
  nodes(renderExplore()).some(
    (n) => n.type === 'option' && n.props.value === 'public' && n.props.hidden
  )
);
// Exercise the existing URL-scoped back-position effect with category and search.
const storage = new Map();
global.sessionStorage = {
  getItem: (key) => storage.get(key),
  setItem: (key, value) => storage.set(key, value),
};
global.window = {
  scrollY: 640,
  innerHeight: 800,
  scrollTo: (_x, y) => {
    window.scrollY = y;
  },
  addEventListener() {},
  removeEventListener() {},
};
global.document = { documentElement: { scrollHeight: 3000 } };
let frame;
global.requestAnimationFrame = (fn) => {
  frame = fn;
  return 1;
};
global.cancelAnimationFrame = () => {};
query = { source: 'curated', q: 'Space' };
effects = [];
library.ExploreListsPage();
let cleanup = effects[0]();
events.get('routeChangeStart')();
cleanup();
window.scrollY = 0;
effects = [];
library.ExploreListsPage();
cleanup = effects[0]();
frame();
assert.equal(window.scrollY, 640);
cleanup();
query = { source: 'letterboxd', q: 'Space' };
effects = [];
library.ExploreListsPage();
cleanup = effects[0]();
frame();
assert.equal(window.scrollY, 0);
cleanup();
// Render the actual card function obtained from the slider's items.
function card() {
  const slider = nodes(curated.default()).find((n) => n.props?.sliderKey);
  const element = slider.props.items[0];
  return element.type(element.props);
}
response = undefined;
requests = [];
assert.equal(card().props.role, 'status');
assert(
  !requests.some(
    (key) => typeof key === 'string' && key.startsWith('/api/v1/movie/')
  ),
  'full-card loading must not fetch legacy backdrops'
);
error = new Error('offline');
tree = card();
assert.equal(tree.props.role, 'alert');
nodes(tree)
  .find((n) => n.type === 'button')
  .props.onClick();
assert.equal(retries, 1);
error = undefined;
response = { results: [] };
assert.equal(card().props.role, 'alert');
response = { results: lists };
assert(nodes(card()).some((n) => n.type === library.ListCard));
error = new Error('background refresh failed');
assert(
  nodes(card()).some((n) => n.type === library.ListCard),
  'retain loaded card during refresh failures'
);
error = undefined;
discovery = { ...discovery, enabled: false, loading: true };
assert.equal(card().props.role, 'status');
discovery = { ...discovery, loading: false };
assert.equal(card().type, 'link', 'resolved disabled mode retains legacy card');
discovery = {
  ...discovery,
  enabled: true,
  href: (url) => url + '&previewUserId=12',
};
const slider = nodes(curated.default()).find((n) => n.props?.sliderKey);
assert(
  nodes(slider.props.header).some(
    (n) => n.props?.href === '/lists/explore?source=curated&previewUserId=12'
  )
);
console.log(
  'PASS: source/search intersection, public eligibility and availability, URL transitions, scoped back position, curated loading/error/ready/disabled states, no legacy fetch, heading preview link'
);

// Media scope intersects source and text, never flashes an unfiltered result.
discovery = { ...discovery, href: (url) => url, previewUserId: '12' };
response = { results: lists };
query = {
  source: 'letterboxd',
  q: 'Space',
  mediaType: 'movie',
  mediaId: '843',
  mediaTitle: 'In the Mood for Love',
  previewUserId: '12',
};
membershipResponse = undefined;
assert.deepEqual(ids(renderExplore()), []);
membershipResponse = { results: [{ id: 'lb' }, { id: 'curated-one' }] };
assert.deepEqual(ids(renderExplore()), ['lb']);
assert(
  requests.some(
    (k) =>
      Array.isArray(k) &&
      k[0] === '/api/v1/discovery-lists/media/movie/843' &&
      k[2] === '12'
  )
);
tree = renderExplore();
nodes(tree)
  .find((n) => n.props?.['aria-label'] === 'Remove media filter')
  .props.onClick();
assert.deepEqual(calls.pop()[1].query, {
  source: 'letterboxd',
  q: 'Space',
  previewUserId: '12',
});
query = { mediaType: 'movie', mediaId: 'nope' };
assert.deepEqual(ids(renderExplore()), []);
assert(nodes(renderExplore()).some((n) => n.props?.role === 'alert'));
query = { mediaType: 'movie', mediaId: '843' };
membershipResponse = { results: [] };
assert.deepEqual(ids(renderExplore()), []);
membershipError = new Error('offline');
assert(
  nodes(renderExplore()).some(
    (n) => n.type === 'button' && String(n.props.children).includes('Retry')
  )
);
membershipError = undefined;
// Actual card: no membership network call outside viewport, no Lists when empty.
const mediaCard = load('src/components/Discover/MediaLists.tsx').default;
const props = {
  type: 'movie',
  id: 843,
  title: 'Film & Title',
  collection: { id: 1, name: 'Collection' },
};
viewport = false;
requests = [];
membershipResponse = undefined;
tree = mediaCard(props);
assert(!requests.some(Boolean));
assert.equal(nodes(tree).filter((n) => n.type === 'link').length, 1);
viewport = true;
membershipResponse = { results: [] };
assert.equal(
  nodes(mediaCard(props)).filter((n) => n.type === 'link').length,
  1
);
membershipResponse = { results: [{ id: 'lb' }] };
tree = mediaCard(props);
const target = nodes(tree).find(
  (n) => n.type === 'link' && n.props.href.includes('/lists/explore')
);
assert(target);
assert(
  target.props.href.includes(
    'mediaType=movie&mediaId=843&mediaTitle=Film+%26+Title'
  )
);
assert(
  nodes(tree).some((n) => String(n.props?.className).includes('grid-cols-2'))
);
membershipResponse = { results: [] };
tree = mediaCard({ ...props, collection: null });
assert(!nodes(tree).some((n) => n.type === 'link'));
console.log(
  'PASS: media/source/search intersection, scope removal, loading/error/invalid/empty states, deferred card lookup and hidden empty card'
);
