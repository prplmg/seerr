/* eslint-disable @typescript-eslint/no-explicit-any -- Isolated render harness for list-only roster contracts. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { it } from 'node:test';
import ts from 'typescript';
const jsx = (type: any, props: any) => ({ type, props });
function load(file: string, mocks: Record<string, any> = {}) {
  const exports: any = {};
  const source = ts.transpileModule(
    fs.readFileSync(path.join(__dirname, file), 'utf8'),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
    }
  ).outputText;
  new Function('require', 'exports', source)((name: string) => {
    if (name === 'react/jsx-runtime')
      return { jsx, jsxs: jsx, Fragment: 'fragment' };
    if (name in mocks) return mocks[name];
    return new Proxy(function Stub() {}, {
      get: (_target, key) =>
        key === '__esModule' ? false : function Stub() {},
    });
  }, exports);
  return exports;
}
const layout = load('compactRosterLayout.ts');
function nodes(value: any): any[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap(nodes);
  return typeof value === 'object'
    ? [value, ...nodes(value.props?.children)]
    : [];
}
const people = (count: number) =>
  Array.from({ length: count }, (_, id) => ({
    id,
    name: `Viewer ${id}`,
    avatar: `/avatar-${id}.png`,
  }));
const party = {
  id: 'party',
  members: people(12),
  mine: true,
  canReturn: true,
  external: {
    title: 'Video',
    url: 'https://youtube.com/watch?v=test',
    thumbnail: '/video.png',
  },
};
const mocks = {
  react: {
    useState: (value: any) => [value, () => {}],
    useRef: () => ({ current: null }),
    useEffect: () => {},
  },
  '@app/components/WatchParty/messages': {
    usePartyText: () => (en: string) => en,
  },
};
it('fits every available avatar before reserving overflow, including four faces at mobile widths', () => {
  assert.deepEqual(layout.compactRosterLayout(4, 144, 28), {
    visible: 4,
    hidden: 0,
  });
  assert.deepEqual(layout.compactRosterLayout(4, 92, 28), {
    visible: 4,
    hidden: 0,
  });
  assert.deepEqual(layout.compactRosterLayout(6, 144, 28), {
    visible: 6,
    hidden: 0,
  });
  assert.deepEqual(layout.compactRosterLayout(12, 144, 28), {
    visible: 4,
    hidden: 8,
  });
  assert.deepEqual(layout.compactRosterLayout(12, 168, 28), {
    visible: 5,
    hidden: 7,
  });
  for (const width of [40, 76, 94, 114, 130, 144, 168, 210]) {
    for (const count of [1, 3, 4, 12, 100]) {
      const { visible, hidden } = layout.compactRosterLayout(count, width, 28);
      assert.equal(visible + hidden, count);
      const used = hidden ? visible * 24 + 28 : visible * 24 - 4;
      assert(used <= width, `${count} people overflow ${width}px`);
    }
  }
});
it('retains vertical names for 1–3 standalone viewers and leaves detail rosters unchanged', () => {
  function Compact() {}
  const rosterModule = load('index.tsx', {
    ...mocks,
    '@app/components/WatchParty/CompactWatchingRoster': Compact,
  });
  for (const count of [1, 2, 3]) {
    const tree = rosterModule.WatchingPeople({
      item: { viewers: people(count), parties: [] },
      list: true,
    });
    assert(tree.props.className.includes('flex-col'));
    assert.equal(
      nodes(tree).filter(
        (n) => n.type === 'span' && typeof n.props.children === 'string'
      ).length,
      count
    );
  }
  const wrapped = rosterModule.WatchingPeople({
    item: { viewers: people(12), parties: [] },
    list: true,
  });
  assert(wrapped.props.className.includes('flex-wrap'));
  assert.equal(nodes(wrapped).filter((n) => n.props?.person).length, 12);
  assert(!nodes(wrapped).some((n) => n.type === Compact));
  const otherParty = rosterModule.WatchingPeople({
    item: { viewers: [], parties: [{ ...party, mine: false }] },
    list: true,
  });
  assert.equal(
    nodes(otherParty).find((n) => n.type === rosterModule.PartyPill).props
      .compact,
    false
  );
  const details = rosterModule.WatchingPeople({
    item: { viewers: people(12), parties: [party] },
  });
  assert(details.props.className.includes('flex-wrap'));
  assert.equal(
    nodes(details).find((n) => n.type === rosterModule.PartyPill).props.compact,
    false
  );
});
it('preserves mixed party groups, own-party distinction and YouTube return controls', () => {
  function Compact() {}
  const rosterModule = load('index.tsx', {
    ...mocks,
    '@app/components/WatchParty/CompactWatchingRoster': Compact,
  });
  const parties = [party, { ...party, id: 'other', mine: false }];
  const tree = rosterModule.WatchingPeople({
    item: { viewers: people(4), parties },
    list: true,
  });
  assert(tree.props.className.includes('flex-col'));
  const pills = nodes(tree).filter((n) => n.type === rosterModule.PartyPill);
  assert.equal(pills.length, 2);
  for (const pill of pills)
    assert(pill.props.compact && pill.props.hasOwnParty);
  const own = rosterModule.PartyPill(pills[0].props),
    other = rosterModule.PartyPill(pills[1].props);
  assert(own.props.className.includes('flex-nowrap'));
  assert(own.props.className.includes('border-purple-400'));
  assert(other.props.className.includes('border-gray-500'));
  assert(nodes(own).some((n) => n.props?.children === 'Your party'));
  assert(
    nodes(own).some(
      (n) => n.props?.['aria-label'] === 'Currently on YouTube: Video'
    )
  );
  assert(
    nodes(own).some(
      (n) =>
        n.type === 'button' && n.props.children === 'Return to previous video'
    )
  );
  assert(
    !nodes(other).some(
      (n) =>
        n.type === 'button' && n.props.children === 'Return to previous video'
    )
  );
});
it('overflow is a labelled popover with portalled names and pictures for every hidden viewer', () => {
  const Popover = Object.assign(function Popover() {}, {
    Button: 'popover-button',
    Panel: 'popover-panel',
  });
  const component = load('CompactWatchingRoster.tsx', {
    ...mocks,
    react: {
      ...mocks.react,
      useState: (value: any) => [
        value?.width === 0 ? { width: 144, overflow: 28 } : value,
        () => {},
      ],
    },
    '@headlessui/react': { Popover, Portal: 'portal' },
    './compactRosterLayout': layout,
    '@app/components/Common/CachedImage': 'image',
  }).default;
  const tree = component({ people: people(12) });
  assert(tree.props.className.includes('h-7'));
  const popover = nodes(tree).find((n) => n.type === Popover);
  const opened = popover.props.children({ open: true });
  const button = nodes(opened).find((n) => n.type === 'popover-button');
  assert.equal(button.props['aria-label'], 'Show 8 more viewers');
  assert(nodes(opened).some((n) => n.type === 'portal'));
  const panelElement = nodes(opened).find((n) => n.props?.people);
  const panel = panelElement.type(panelElement.props);
  assert.equal(panel.props.focus, true);
  const rows = nodes(panel).filter((n) => n.type === 'li');
  assert.equal(rows.length, 8);
  for (const [index, row] of rows.entries()) {
    assert(nodes(row).some((n) => n.props?.children === `Viewer ${index + 4}`));
    const avatar = nodes(row).find((n) => n.props?.person);
    const image = nodes(avatar.type(avatar.props)).find(
      (n) => n.type === 'image'
    );
    assert.equal(image.props.src, `/avatar-${index + 4}.png`);
  }
});
it('WatchingCard fixes height and gives roster remaining scroll space outside playback controls', () => {
  function WatchingPeople() {}
  function PartyControls() {}
  const component = load('../Discover/WatchingNowSlider.tsx', {
    ...mocks,
    '@app/components/WatchParty': { WatchingPeople, PartyControls },
    'react-intersection-observer': { useInView: () => ({ inView: false }) },
    swr: () => ({}),
  }).WatchingCard;
  const tree = component({
    item: {
      mediaType: 'movie',
      tmdbId: 1,
      viewers: people(12),
      parties: [party],
    },
  });
  assert(tree.props.className.includes('h-[152px]'));
  assert(tree.props.className.includes('sm:h-[200px]'));
  assert(!tree.props.className.includes('min-h-'));
  const roster = nodes(tree).find((n) =>
    n.props?.className?.includes('overflow-y-auto')
  );
  assert(roster.props.className.includes('min-h-0'));
  assert(nodes(roster).some((n) => n.type === WatchingPeople));
  assert(!nodes(roster).some((n) => n.type === PartyControls));
  assert(
    nodes(tree).some((n) => n.type === PartyControls && n.props.party === party)
  );
});
