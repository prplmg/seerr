import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { it } from 'node:test';
import ts from 'typescript';
const code = ts.transpileModule(
  fs.readFileSync(path.join(__dirname, 'index.tsx'), 'utf8') +
    '\nexport { Rating, ReviewBody };',
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }
).outputText;
function harness(es = false) {
  const out: any = {};
  new Function('require', 'exports', code)((name: string) => {
    if (name === 'react/jsx-runtime')
      return {
        jsx: (type: any, props: any) => ({ type, props }),
        jsxs: (type: any, props: any) => ({ type, props }),
      };
    if (name === 'react') return { useState: () => [false, () => {}] };
    if (name.endsWith('/messages'))
      return {
        usePartyText: () => (en: string, spanish: string) =>
          es ? spanish : en,
      };
    return {};
  }, out);
  return out;
}
function nodes(n: any): any[] {
  return n && typeof n === 'object'
    ? [n, ...[n.props?.children].flat(Infinity).flatMap(nodes)]
    : [];
}
const review = {
  id: 'local:1:1',
  source: 'local',
  syncedToLetterboxd: true,
  rating: 2.5,
  text: 'Review',
  spoiler: false,
  externalUrl: 'https://letterboxd.com/prplmg/film/jaws/2/',
};
it('green underline belongs only to the purple source label, not the stars', () => {
  const { Rating } = harness();
  const tree = Rating({ review });
  assert.equal(tree.props.className, 'text-purple-300');
  const decorated = nodes(tree).filter(
    (n) => n.props.style?.textDecorationLine
  );
  assert.equal(decorated.length, 1);
  assert.equal(decorated[0].props.children, 'Multimeldia');
  assert.match(decorated[0].props.className, /decoration-green-400/);
  for (const r of [
    { ...review, syncedToLetterboxd: false },
    { ...review, source: 'letterboxd' },
  ])
    assert.equal(
      nodes(Rating({ review: r })).filter(
        (n) => n.props.style?.textDecorationLine
      ).length,
      0
    );
});
it('body does not duplicate footer actions in detail or compact cards', () => {
  for (const es of [false, true]) {
    const { ReviewBody } = harness(es);
    assert.equal(
      nodes(ReviewBody({ review })).filter((n) => n.type === 'a').length,
      0
    );
    assert.equal(
      nodes(ReviewBody({ review, compact: true })).filter((n) => n.type === 'a')
        .length,
      0
    );
  }
});
it('detail footer keeps nonwrapping edit action and compact labelled sync icons', () => {
  const source = fs.readFileSync(path.join(__dirname, 'index.tsx'), 'utf8');
  const footer = source.slice(
    source.indexOf('<ReviewBody review={r} />'),
    source.indexOf('</article>', source.indexOf('<ReviewBody review={r} />'))
  );
  assert.match(footer, /href=\{r.externalUrl\}/);
  assert.match(footer, /r\.syncedToLetterboxd\s*&&\s*!r\.externalUrl\s*&&/);
  assert.match(
    footer,
    /<CheckCircleIcon\s+aria-hidden="true"\s+className="h-4 w-4"\s*\/>/
  );
  assert.match(footer, /shrink-0 whitespace-nowrap/);
  assert.ok(
    footer.indexOf("t('Edit',") < footer.indexOf('Synced with Letterboxd')
  );
  assert.ok(
    footer.indexOf('Letterboxd ↗') < footer.indexOf('Synced with Letterboxd')
  );
});
