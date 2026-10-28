const fs=require('fs'),crypto=require('crypto'),assert=require('assert/strict'),{DatabaseSync}=require('node:sqlite');
const root='C:/ProgramData/Seerr',release=root+'/catalogue-20261028171130859-12079-release';
(async()=>{const key=JSON.parse(fs.readFileSync(root+'/data/settings.json')).main.apiKey;const get=async p=>{const r=await fetch('https://catalogue.prpl.com.mx/api/v1'+p,{headers:{'X-Api-Key':key,'X-API-User':'1'},redirect:'error',signal:AbortSignal.timeout(30000)});assert(r.ok,'API '+r.status);return r.json();};
const [feed,film]=await Promise.all([get('/reviews?days=28'),get('/reviews?movieId=1283515&mediaType=movie')]);
const date=r=>r.watchedDate||r.publishedAt.slice(0,10);assert(feed.results.length);for(let i=1;i<feed.results.length;i++)assert(date(feed.results[i-1])>=date(feed.results[i]));
const verity=film.results.find(r=>r.userId===5&&r.watchedDate==='2026-10-27');assert(verity,'Expected Verity review absent');
const b=JSON.parse(fs.readFileSync(root+'/data/letterboxd-browser.json')),w=JSON.parse(fs.readFileSync(root+'/data/letterboxd-write-queue.json'));const db=new DatabaseSync(root+'/data/db/db.sqlite3',{readOnly:true});
const toggles={settings:w.settings,bindings:b.bindings.map(b=>({id:b.userId,instance:b.instance,enabled:b.enabled})),rss:db.prepare('SELECT userId,enabled FROM letterboxd_account ORDER BY userId').all()};const hash=crypto.createHash('sha256').update(JSON.stringify(toggles)).digest('hex');assert.equal(hash,'efc1909bb44d5c3b37c841fb3c0520d7f999a48524050cade273b7107ef89c5e');

const receipt={at:new Date().toISOString(),build:fs.readFileSync(root+'/app/.next/BUILD_ID','utf8').trim(),toggleHash:hash,feedOrderedByWatchDate:true,feedRows:feed.results.length,verity:{id:verity.id,watchedDate:verity.watchedDate,publishedAt:verity.publishedAt}};db.close();fs.writeFileSync(release+'/chronology-verified.json',JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));})().catch(e=>{console.error(e.message);process.exitCode=1});
