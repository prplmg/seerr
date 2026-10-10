const fs = require('fs');
const vm = require('vm');
const assert = require('node:assert/strict');
const root = process.argv[2] || require('path').resolve(__dirname, '..');
const ts = require(root + '/node_modules/typescript');
const jsx = (type, props) => ({ type, props: props || {} });
let effects = [], changes = [];
const mocks = {
  'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
  react: { useState: () => [false, value => changes.push(value)], useEffect: fn => effects.push(fn) },
  'react-intl': { useIntl: () => ({ formatMessage: message => message.defaultMessage || message }) },
  '@app/utils/defineMessages': { default: (_, messages) => messages },
  '@app/hooks/useSettings': { default: () => ({ currentSettings: { mediaServerType: 1 } }) },
  '@server/constants/server': { MediaServerType: { PLEX: 1 } },
  '@heroicons/react/24/outline': { FilmIcon: 'FilmIcon' },
};
function load(file) {
  const code = ts.transpileModule(fs.readFileSync(root + '/' + file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX }
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, require: name => mocks[name] || { default: name } });
  return exports.default;
}
function nodes(node) {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(nodes);
  return [node, ...nodes(node.props.children)];
}
const Actions = load('src/components/MediaActions/index.tsx');
let rendered = nodes(Actions({ links: [{ url: 'plex://item', text: 'Play on Plex' }, { url: 'plex://4k', text: 'Play on Plex 4K' }], trailerUrl: 'https://youtube.com/test', movieId: 157350 }));
assert.equal(rendered.filter(n => n.props.as === 'a').length, 4);
assert(rendered.some(n => n.props.href === 'https://letterboxd.com/tmdb/157350/'));
assert(rendered.some(n => n.props.children === '4K'));
assert.equal(nodes(Actions({ links: [] })).filter(n => n.props.as === 'a').length, 0);
const Progress = load('src/components/DownloadProgressBadge/index.tsx');
let idle = Progress({ downloadItem: [] });
assert.equal(idle.props.readOnly, true);
assert.equal(nodes(idle).filter(n => n.type === 'button').length, 0);
effects.forEach(fn => fn());
assert(changes.includes(false));
rendered = nodes(Progress({ downloadItem: [{ downloadId: 'one', externalId: 1 }], title: 'Movie' }));
const button = rendered.find(n => n.type === 'button');
assert(button);
button.props.onClick();
assert.equal(changes.at(-1), true);
assert.equal(rendered.filter(n => n.type === '@app/components/DownloadBlock').length, 1);
assert(!rendered.some(n => String(n.type).includes('Manage')));
const status = fs.readFileSync(root + '/src/components/StatusBadge/index.tsx', 'utf8');
assert(status.includes('!readOnly && mediaType') || /!readOnly\s*&&\s*mediaType/.test(status));
assert(/!readOnly && hasPermission\(Permission.MANAGE_REQUESTS\)/.test(status));
console.log('PASS: independent action links, movie-only Letterboxd, 4K retained, inert idle pill, active read-only drawer, close on completion, guarded legacy links');
