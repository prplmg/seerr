const fs=require('fs'),path=require('path');
const pattern=/^catalogue-\d{17}-\d+-release$/;
function json(p){try{return JSON.parse(fs.readFileSync(p,'utf8'));}catch{return null;}}
function plan(root){
 const live=fs.readFileSync(path.join(root,'app/.next/BUILD_ID'),'utf8').trim();
 const names=fs.readdirSync(root).filter(n=>pattern.test(n)&&!fs.lstatSync(path.join(root,n)).isSymbolicLink()).sort().reverse();
 const valid=names.filter(n=>{const v=json(path.join(root,n,'verified.json'));return v?.health===true&&v.buildId===live;});
 const keep=valid[0];if(!keep)throw Error('No verified rollback matching live build');
 for(const f of ['previous/.next/BUILD_ID','previous/dist'])if(!fs.existsSync(path.join(root,keep,f)))throw Error('Current rollback incomplete');
 const remove=[];
 // Runtime targets live outside staging/release payloads so absolute junctions
 // remain valid. Keep both live and the single rollback's dependency tree.
 const referenced=new Set();
 for(const app of [path.join(root,'app'),path.join(root,keep,'previous')]){
  const modules=path.join(app,'node_modules');
  if(fs.existsSync(modules))referenced.add(fs.realpathSync(modules));
 }

 for(const n of names){
  const dir=path.join(root,n),v=json(path.join(dir,'verified.json'));
  if(!v?.health)continue; // Failed/incomplete releases need manual inspection.
  if(n!==keep)for(const e of fs.readdirSync(dir)){if(!['receipt.json','verified.json','built.json','mini-preflight.json','retention.json'].includes(e))remove.push(path.join(dir,e));}
  const runtime=path.join(root,n.replace(/-release$/,'-runtime'));
  if(fs.existsSync(runtime)&&!referenced.has(fs.realpathSync(path.join(runtime,'node_modules'))))remove.push(runtime);
  const stage=path.join(root,n.replace(/-release$/,'-native'));if(fs.existsSync(stage))remove.push(stage);
 }
 return {keep,remove};
}
// Never traverse directory junctions: unlink the link, not its shared target.
function erase(p){const st=fs.lstatSync(p);if(st.isSymbolicLink()){fs.unlinkSync(p);return;}if(st.isDirectory()){for(const e of fs.readdirSync(p))erase(path.join(p,e));fs.rmdirSync(p);}else fs.unlinkSync(p);}
function run(root,apply=false){const p=plan(root);if(apply){for(const f of p.remove)erase(f);fs.writeFileSync(path.join(root,p.keep,'retention.json'),JSON.stringify({at:new Date().toISOString(),keep:p.keep,removed:p.remove}));}return {...p,applied:apply};}
module.exports={plan,run,erase};
if(require.main===module){const root=process.argv[2]||'C:/ProgramData/Seerr';const lock=path.join(root,'catalogue-deploy.lock');fs.mkdirSync(lock);try{console.log(JSON.stringify(run(root,process.argv.includes('--apply'))));}finally{fs.rmdirSync(lock);}}
