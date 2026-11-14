const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path');const {run}=require('./retention.cjs');
test('one rollback, receipts retained, junction targets preserved, repeat safe',()=>{const r=fs.mkdtempSync(path.join(os.tmpdir(),'retention-'));const write=(p,s)=>{fs.mkdirSync(path.dirname(path.join(r,p)),{recursive:true});fs.writeFileSync(path.join(r,p),s);};try{write('app/.next/BUILD_ID','live');write('shared/important','safe');for(let i=1;i<=2;i++){const n=`catalogue-20261110185303791-${i}`;write(n+'-release/verified.json',JSON.stringify({health:true,buildId:i===2?'live':'old'}));write(n+'-release/receipt.json','{}');write(n+'-release/previous/.next/BUILD_ID','older');write(n+'-release/previous/dist/index.js','x');write(n+'-native/src/x','x');fs.symlinkSync(path.join(r,'shared'),path.join(r,n+'-native/node_modules'),'junction');}run(r,true);assert.equal(fs.readFileSync(path.join(r,'shared/important'),'utf8'),'safe');assert.equal(fs.existsSync(path.join(r,'catalogue-20261110185303791-1-release/previous')),false);assert.equal(fs.existsSync(path.join(r,'catalogue-20261110185303791-2-release/previous')),true);assert.equal(fs.existsSync(path.join(r,'catalogue-20261110185303791-1-release/receipt.json')),true);assert.equal(run(r,true).remove.length,0);write('app/.next/BUILD_ID','unknown');assert.throws(()=>run(r,true),/No verified/);}finally{fs.rmSync(r,{recursive:true,force:true});}});
test('dependency retention keeps live and rollback targets across three upgrades',()=>{
 const r=fs.mkdtempSync(path.join(os.tmpdir(),'runtime-retention-'));
 const id=i=>`catalogue-20261110185303791-${i}`;
 const write=(p,s)=>{fs.mkdirSync(path.dirname(path.join(r,p)),{recursive:true});fs.writeFileSync(path.join(r,p),s);};
 try {
  write('app/.next/BUILD_ID','live');
  for(let i=1;i<=3;i++){
   write(id(i)+'-runtime/node_modules/package.txt',String(i));
   write(id(i)+'-release/verified.json',JSON.stringify({health:true,buildId:i===3?'live':'old'}));
   write(id(i)+'-release/previous/.next/BUILD_ID','old');write(id(i)+'-release/previous/dist/index.js','x');
  }
  fs.symlinkSync(path.join(r,id(3)+'-runtime/node_modules'),path.join(r,'app/node_modules'),'junction');
  fs.symlinkSync(path.join(r,id(2)+'-runtime/node_modules'),path.join(r,id(3)+'-release/previous/node_modules'),'junction');
  run(r,true);
  assert.equal(fs.existsSync(path.join(r,id(1)+'-runtime')),false);
  assert.equal(fs.readFileSync(path.join(r,'app/node_modules/package.txt'),'utf8'),'3');
  assert.equal(fs.readFileSync(path.join(r,id(3)+'-release/previous/node_modules/package.txt'),'utf8'),'2');
  assert.equal(run(r,true).remove.length,0);
 }finally{fs.rmSync(r,{recursive:true,force:true});}
});
