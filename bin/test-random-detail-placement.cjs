const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
for (const component of ['MovieDetails', 'TvDetails']) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/components', component, 'index.tsx'), 'utf8');
  const header = source.indexOf('<div className="media-title">');
  const pick = source.indexOf('<RandomPickButton');
  const status = source.indexOf('<div className="media-status">');
  const actions = source.indexOf('<MediaActions');
  assert.ok(header < pick && pick < status && status < actions, component);
  assert.equal((source.match(/<RandomPickButton/g) || []).length, 1);
  assert.ok(source.slice(header, status).includes('justify-center xl:justify-start'));
  assert.ok(source.slice(header, status).includes("router.query.random === '1'"));
  assert.ok(source.slice(header, status).includes('exclude={data.mediaInfo?.id}'));
}
console.log('PASS: movie and TV random actions precede availability, align responsively, and remain outside playback actions.');
