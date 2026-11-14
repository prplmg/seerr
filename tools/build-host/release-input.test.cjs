const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {allowed,apply}=require('./release-input.cjs');
test('upgrade payload admits configs and nativeNode helpers but excludes unsafe paths',()=>{
 for(const p of ['next.config.ts','next.config.mjs','server/utils/nativeNode.ts','server/tsconfig.build.json','server/templates/email.pug'])assert.ok(allowed(p),p);
 for(const p of ['../package.json','server/../../secret.ts','server/a\\b.ts','.env','node_modules/a.js','server/x.test.ts'])assert.equal(allowed(p),false,p);
});
test('explicit config deletion and replacement can be reversed',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'release-source-'));
 try {
  const live=path.join(dir,'live'),src=path.join(dir,'src');fs.mkdirSync(live);fs.mkdirSync(src);
  fs.writeFileSync(path.join(live,'next.config.ts'),'old');fs.writeFileSync(path.join(src,'next.config.mjs'),'new');
  apply(live,{file:'next.config.ts',afterHash:null},src);
  apply(live,{file:'next.config.mjs',afterHash:'new'},src);
  assert.equal(fs.existsSync(path.join(live,'next.config.ts')),false);
  assert.equal(fs.readFileSync(path.join(live,'next.config.mjs'),'utf8'),'new');
  apply(live,{file:'next.config.mjs',afterHash:null},src);
  fs.writeFileSync(path.join(src,'next.config.ts'),'old');apply(live,{file:'next.config.ts',afterHash:'old'},src);
  assert.equal(fs.readFileSync(path.join(live,'next.config.ts'),'utf8'),'old');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
