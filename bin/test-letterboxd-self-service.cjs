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
assert.match(deletion,/!managesLetterboxd\(req, userId\)/);
assert.match(deletion,/disableLetterboxdBrowser\(userId\)/);
assert.match(source,/importCompletedAt: new Date\(\).toISOString\(\)/);
assert.match(source,/old && old.username !== username/);
const ui=fs.readFileSync('src/components/Reviews/LetterboxdSettings.tsx','utf8');
assert.match(ui,/canManage = isAdmin \|\| user\?\.id === userId/);
assert.match(ui,/https:\/\/letterboxd.com\/user\/exportdata\//);
assert.match(ui,/Do not enter your password here/);
assert.match(ui,/data && !data\.fullyIntegrated/);
const ast=ts.createSourceFile('reviews.ts',source,ts.ScriptTarget.Latest,true);
let integration;
function visit(node){if(ts.isPropertyAssignment(node)&&node.name.getText(ast)==='fullyIntegrated')integration=node.initializer.getText(ast);ts.forEachChild(node,visit);}
visit(ast);assert.ok(integration);
const runIntegration=(binding,setting,owner=true)=>vm.runInNewContext(ts.transpileModule(`result = ${integration}`,{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText,{
 req:{},userId:5,account:{username:'margotnochill'},managesLetterboxd:()=>owner,
 readBrowserState:()=>({bindings:binding?[binding]:[]}),readWriteState:()=>({settings:setting?{5:setting}:{}})
});
const binding={userId:5,username:'margotnochill',enabled:true};
assert.equal(runIntegration(binding,{account:'margotnochill',enabled:true}),true);
assert.equal(runIntegration(binding,undefined),false);
assert.equal(runIntegration(undefined,{account:'margotnochill',enabled:true}),false);
assert.equal(runIntegration(binding,{account:'someoneelse',enabled:true}),false);
assert.equal(runIntegration(binding,{account:'margotnochill',enabled:true},false),false);
console.log('PASS: own-account access, cross-user denial, admin access, invalid IDs, protected unlink/reassignment, export link and setup notice');
