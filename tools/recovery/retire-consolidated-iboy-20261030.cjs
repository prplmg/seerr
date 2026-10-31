// Run only while the catalogue is stopped, after the release's state backup.
{
 const assert=require('node:assert/strict'),{DatabaseSync}=require('node:sqlite');
 const data=root+'/data',entry='https://letterboxd.com/prplmg/film/iboy/',event='tautulli:99c72463778de0c815b5bc16d0ca9b45da15bcaab95e2f48499a5995d8824b4a';
 const approval=JSON.parse(fs.readFileSync(data+'/iboy-viewing-consolidation-20261030.json','utf8'));
 assert.equal(approval.event.id,event);assert.equal(approval.reason,'User explicitly confirmed Plex and party are the same viewing');
 const db=new DatabaseSync(data+'/db/db.sqlite3',{readOnly:true});let local;try{local=db.prepare('SELECT * FROM movie_review WHERE id=?').get(approval.row.id);}finally{db.close();}
 assert.equal(local.userId,1);assert.equal(local.viewingEventId,event);assert.equal(local.externalEntryId,entry);assert.equal(local.watchedDate,'2026-10-28');
 const writes=JSON.parse(fs.readFileSync(data+'/letterboxd-write-queue.json','utf8'));
 assert(!writes.intents.some(i=>i.userId===1&&i.film==='iboy'&&!['verified','cancelled'].includes(i.state)));
 const receipts=JSON.parse(fs.readFileSync(data+'/letterboxd-sync-receipts.json','utf8')).entries;
 const linked=receipts.find(r=>r.userId===1&&r.account==='prplmg'&&r.originId===local.id&&r.entryId===entry);
 assert(linked&&linked.boundDiaryOriginId===approval.partyReceipt.originId);
 for(const k of ['rating','text','spoiler'])assert.equal(k==='spoiler'?!!local[k]:local[k],linked.baseline[k]);
 const cutoff=fs.statSync(data+'/iboy-viewing-consolidation-20261030.json').mtimeMs;
 const file=data+'/letterboxd-observations.json',state=JSON.parse(fs.readFileSync(file,'utf8'));let retired=0;
 for(const r of state.requests)if(r.userId===1&&r.account==='prplmg'&&r.film==='iboy'&&!r.createNew&&(!r.entryId||r.entryId===entry)&&r.requestedAt<=cutoff&&!r.retired){r.retired={at:Date.now(),reason:'user-confirmed-viewing-consolidation:'+event};retired++;}
 const temp=file+'.retire.tmp';fs.writeFileSync(temp,JSON.stringify(state));fs.renameSync(temp,file);
 const continuation=data+'/letterboxd-playback-continuation.json';const batch=JSON.parse(fs.readFileSync(continuation,'utf8'));batch.events=batch.events.filter(e=>e.id!==event);fs.writeFileSync(continuation,JSON.stringify(batch));
 console.log(JSON.stringify({retiredConsolidatedIboyChecks:retired,preservedResults:true,remoteWrites:0}));
}
