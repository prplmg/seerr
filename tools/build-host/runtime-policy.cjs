const fs=require('node:fs'),cp=require('node:child_process'),crypto=require('node:crypto');
const nodeVersion='v22.23.5';
const expectedNodeHash='247e9693d316da9857e44990e5e11709f596f18112251b8026ec6eed80bdf38a';
const miniNode='C:/ProgramData/Seerr/node-v22.23.5/node.exe';
const pcNode='D:/CatalogueBuilder/node-v22.23.5/node.exe';
const digest=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function checkNode(executable){
 if(digest(executable)!==expectedNodeHash)throw Error('Node executable does not match verified official Windows x64 binary');
 const info=JSON.parse(cp.execFileSync(executable,['-p','JSON.stringify({version:process.version,arch:process.arch,platform:process.platform})'],{encoding:'utf8'}));
 if(info.version!==nodeVersion||info.arch!=='x64'||info.platform!=='win32')throw Error('Expected Windows x64 Node '+nodeVersion);
 return {executable,version:info.version,hash:digest(executable)};
}
function launcherChange(before,newExe=miniNode.replaceAll('/','\\')){
 const matches=[...before.matchAll(/& '([^'\r\n]+\\node\.exe)'/g)];
 if(matches.length!==2||matches[0][1]!==matches[1][1])throw Error('Unexpected startup launcher: review before switching Node');
 const oldExe=matches[0][1];
 const after=before.replaceAll("& '"+oldExe+"'","& '"+newExe+"'");
 return {before,after,oldExe,newExe};
}
function prepareLauncher(root,release){
 const file=root+'/tools/startup/Start-Seerr.ps1';
 const change=launcherChange(fs.readFileSync(file,'utf8'));
 const node=checkNode(miniNode);
 const oldNode={hash:digest(change.oldExe),version:cp.execFileSync(change.oldExe,['-p','process.version'],{encoding:'utf8'}).trim()};
 const launch={file,...change,node,oldNode};
 fs.writeFileSync(release+'/launcher.json',JSON.stringify(launch));
 return launch;
}
function verifyLauncher(release){
 const launch=JSON.parse(fs.readFileSync(release+'/launcher.json','utf8'));
 if(fs.readFileSync(launch.file,'utf8')!==launch.before||digest(miniNode)!==launch.node.hash||digest(launch.oldExe)!==launch.oldNode.hash)throw Error('Launcher or staged Node changed');
 checkNode(miniNode);return launch;
}
module.exports={nodeVersion,expectedNodeHash,miniNode,pcNode,digest,checkNode,prepareLauncher,verifyLauncher,launcherChange};
