// Narrow data repair: existing verified write only; never publishes to Letterboxd.
const fs=require('fs'),assert=require('node:assert/strict'),{DatabaseSync}=require('node:sqlite');
const root=process.env.REPAIR_DATA_ROOT||'C:/ProgramData/Seerr/data';
const state=JSON.parse(fs.readFileSync(root+'/letterboxd-write-queue.json'));
const intent=state.intents.find(i=>i.id==='ca8f8c17-2dba-4556-84e4-f1d2cfb27de3');
assert.equal(intent.userId,1);assert.equal(intent.account,'prplmg');assert.equal(intent.kind,'review');assert.equal(intent.state,'dispatched');
const entry='https://letterboxd.com/prplmg/film/iboy/';assert.equal(intent.entryId,entry);
const receipt=JSON.parse(fs.readFileSync(root+'/letterboxd-sync-receipts.json')).entries.find(r=>r.userId===1&&r.entryId===entry&&r.originId.startsWith('party:'));
assert.equal(receipt.diaryBaseline.watchedDate,'2026-10-28');assert(receipt.verifiedAt>0);
const db=new DatabaseSync(root+'/db/db.sqlite3');db.exec('PRAGMA busy_timeout=5000; BEGIN IMMEDIATE');
try {
 const local=db.prepare('SELECT * FROM movie_review WHERE id=? AND userId=1').get(intent.originEntityId);
 const imported=db.prepare("SELECT * FROM movie_review WHERE userId=1 AND source='letterboxd' AND externalEntryId=?").all(entry);
 assert.equal(imported.length,1);const echo=imported[0];assert.equal(local.tmdbId,414190);assert.equal(echo.tmdbId,414190);assert.equal(local.source,'local');assert.equal(local.externalEntryId,null);assert.equal(local.watchedDate,null);
 for(const key of ['rating','text','spoiler']){assert.equal(local[key],echo[key]);assert.deepEqual(Boolean(key==='spoiler'?local[key]:false),Boolean(key==='spoiler'?intent.desired[key]:false));if(key!=='spoiler')assert.equal(local[key],intent.desired[key]);}
 assert.equal(echo.watchedDate,receipt.diaryBaseline.watchedDate);
 const backup=root+'/iboy-link-backup-20261030.json';fs.writeFileSync(backup,JSON.stringify({local,imported:echo,receipt,intentId:intent.id}),{flag:'wx',mode:0o600});
 const result=db.prepare('UPDATE movie_review SET externalEntryId=?, externalUrl=?, watchedDate=? WHERE id=? AND userId=1 AND externalEntryId IS NULL AND watchedDate IS NULL').run(entry,entry,echo.watchedDate,local.id);assert.equal(result.changes,1);db.exec('COMMIT');console.log(JSON.stringify({linked:true,backup,rowsDeleted:0,remoteWrites:0}));
} catch(e){db.exec('ROLLBACK');throw e;}finally{db.close();}
