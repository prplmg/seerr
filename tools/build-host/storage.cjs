const fs=require('node:fs'),path=require('node:path');
function bytes(root){
 const st=fs.lstatSync(root);if(st.isSymbolicLink())return 0;
 return st.isDirectory()?fs.readdirSync(root).reduce((sum,name)=>sum+bytes(path.join(root,name)),0):st.size;
}
function requireSpace(root,needed){
 const stat=fs.statfsSync(root),free=stat.bavail*stat.bsize;
 if(!Number.isSafeInteger(needed)||needed<0)throw Error('Invalid storage estimate');
 if(free<needed)throw Error('Insufficient Mini space: '+free+' bytes free; '+needed+' required including reserve');
 return {freeBytes:free,requiredBytes:needed};
}
module.exports={bytes,requireSpace};
