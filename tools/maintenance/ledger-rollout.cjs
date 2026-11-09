const fs=require('fs'),path=require('path');
const modulePath=app=>path.join(app,'dist/lib/letterboxdTaskStore.js');
const database=data=>path.join(data,'db/letterboxd-tasks.sqlite3');
function readWriteState(data,app){
 if(!fs.existsSync(database(data)))return JSON.parse(fs.readFileSync(path.join(data,'letterboxd-write-queue.json'),'utf8'));
 const ledger=require(modulePath(app));
 try{return ledger.readTaskDocument(path.join(data,'letterboxd-write-queue.json'),()=>{throw Error('Missing write settings');});}
 finally{ledger.closeTaskStores();}
}
function backupLedger(data,target){
 if(!fs.existsSync(database(data)))return;
 const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(database(data));
 try{const result=db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();if(result.busy)throw Error('Task ledger still in use');}finally{db.close();}
 fs.copyFileSync(database(data),path.join(target,'letterboxd-tasks.sqlite3'));
}
function prepareLegacyRollback(data,current,previous,destination){
 if(!fs.existsSync(database(data))||fs.existsSync(modulePath(previous)))return;
 const ledger=require(modulePath(current));
 try{ledger.exportTaskStore(data,destination);}finally{ledger.closeTaskStores();}
 const manifest=JSON.parse(fs.readFileSync(path.join(destination,'complete.json')));
 for(const name of manifest.documents)fs.copyFileSync(path.join(destination,name),path.join(data,name));
 // The legacy app will update JSON; leave no stale authoritative ledger for a later migration.
 for(const suffix of ['', '-wal','-shm'])if(fs.existsSync(database(data)+suffix))fs.renameSync(database(data)+suffix,path.join(destination,'letterboxd-tasks.sqlite3'+suffix));
}
module.exports={readWriteState,backupLedger,prepareLegacyRollback};
