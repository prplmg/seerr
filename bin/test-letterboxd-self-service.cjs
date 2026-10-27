const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync('server/routes/reviews.ts', 'utf8');
const guard = source.match(/const managesLetterboxd = [\s\S]*?;\n/)[0];
const context = {positive: n => Number.isSafeInteger(n) && n > 0, admin: req => !!req.user?.admin};
vm.createContext(context);
vm.runInContext(ts.transpileModule(guard + '\nglobalThis.check = managesLetterboxd;', {compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText, context);
assert.equal(context.check({user:{id:5}},5),true);
assert.equal(context.check({user:{id:5}},7),false);
assert.equal(context.check({user:{id:1,admin:true}},7),true);
for(const id of [0,-1,NaN,1.5]) assert.equal(context.check({user:{id:1,admin:true}},id),false);
for(const [start,end] of [["router.put('/account/:userId'","router.post("],["'/account/:userId/sync'","'/import/:userId'"],["'/import/:userId'","return await withReviewLock"]]) {
 const block=source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)+start.length));
 assert.match(block,/if \(!managesLetterboxd\(req, userId\)\) return res.sendStatus\(403\)/);
}
const deletion=source.slice(source.indexOf("router.delete('/account/:userId'"),source.indexOf("router.put('/account/:userId'"));
assert.match(deletion,/!admin\(req\)/);
assert.match(source,/old && old.username !== username/);
const ui=fs.readFileSync('src/components/Reviews/LetterboxdSettings.tsx','utf8');
assert.match(ui,/canManage = isAdmin \|\| user\?\.id === userId/);
assert.match(ui,/https:\/\/letterboxd.com\/user\/exportdata\//);
assert.match(ui,/Do not enter your password here/);
console.log('PASS: own-account access, cross-user denial, admin access, invalid IDs, protected unlink/reassignment, export link and setup notice');
