const fs = require('fs'),
  path = require('path'),
  assert = require('assert/strict');
const dir = process.cwd(),
  root = path.resolve(process.argv[2] || path.join(dir, 'runtime')),
  aliases = path.join(root, '.next/node_modules'),
  modules = fs.realpathSync(path.join(root, 'node_modules')),
  links = JSON.parse(fs.readFileSync('runtime-links.json'));
const safe = (root, rel) => {
  const value = path.resolve(root, rel);
  assert.ok(value.startsWith(root + path.sep));
  return value;
};
for (const l of links) {
  const target = safe(modules, l.target),
    pkg = JSON.parse(fs.readFileSync(path.join(target, 'package.json')));
  assert.equal(pkg.name, l.name);
  assert.equal(pkg.version, l.version);
  safe(aliases, l.alias);
}
if (fs.existsSync(aliases))
  throw Error('Archive must exclude .next/node_modules');
assert.ok(links.length, 'No dependency links exported');
for (const l of links) {
  const entry = safe(aliases, l.alias);
  fs.mkdirSync(path.dirname(entry), { recursive: true });
  fs.symlinkSync(safe(modules, l.target), entry, 'junction');
}
console.log(
  'Verified and recreated ' + links.length + ' exact package junctions.'
);
