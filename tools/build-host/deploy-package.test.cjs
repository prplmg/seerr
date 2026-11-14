const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
test('wrapper packages release-local helpers and renders executable engine without remote execution',()=>{
 const fixture=fs.mkdtempSync(path.join(os.tmpdir(),'deploy-package-')),manifest=path.join(fixture,'manifest.json');
 fs.writeFileSync(manifest,JSON.stringify({files:['next.config.mjs','package.json'],delete:['next.config.ts']}));
 const calls=[];let temp;
 const fakeFs=new Proxy(fs,{get(target,key){if(key==='mkdtempSync')return prefix=>(temp=fs.mkdtempSync(prefix));return target[key];}});
 try {
  const context={__dirname,console:{log(){}},process:{argv:['node','deploy',manifest],pid:123},
   require(name){if(name==='fs')return fakeFs;if(name==='child_process')return {execFileSync(bin,args){calls.push({bin,args});if(bin==='git')return '';if(bin==='ssh'&&args.at(-1).includes('Get-Content'))return 'fixture-build\n';return '';}};if(name==='./release-input.cjs')return require(name);return require(name);}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'deploy.cjs'),'utf8'),context);
  const engineFile=fs.readdirSync(temp).find(f=>/^catalogue-[\d-]+\.cjs$/.test(f));assert.ok(engineFile);
  const engine=fs.readFileSync(path.join(temp,engineFile),'utf8');new vm.Script(engine);
  assert.ok(engine.includes('-tools/mini-build.cjs'));assert.ok(engine.includes('-tools/runtime-policy.cjs'));assert.ok(engine.includes('-tools/retention.cjs'));
  assert.equal(engine.includes("root+'/build-host/mini-build.cjs'"),false);
  assert.ok(calls.some(c=>c.bin==='ssh'&&c.args.at(-1).startsWith('C:/ProgramData/Seerr/node-v22.23.5/node.exe ')),'Runner uses patched Node');
  const shipped=calls.filter(c=>c.bin==='scp').flatMap(c=>c.args);
  for(const name of ['runtime-policy.cjs','storage.cjs','migration-preflight.cjs','pc-build.cjs','release-input.cjs'])assert.ok(shipped.includes(path.join(__dirname,name)),name);
  const payload=JSON.parse(fs.readFileSync(path.join(temp,engineFile.replace('.cjs','-source.json'))));assert.equal(payload.at(-1).after,null);
 }finally{if(temp)fs.rmSync(temp,{recursive:true,force:true});fs.rmSync(fixture,{recursive:true,force:true});}
});
