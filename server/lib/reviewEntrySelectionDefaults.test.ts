import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { test } from 'node:test';
import ts from 'typescript';
import { recentUnratedViewing } from './recentUnratedViewing';
function harness(rows: any[], events: any[]){
 const exports: any={};
 const deps: any={
 '@server/datasource':{getRepository:()=>({findBy:async()=>rows})},
 '@server/entity/MovieReview':{MovieReview:{}},
 '@server/utils/appDataVolume':{appDataPath:()=>'/mock'},
 fs:{readFileSync:(f:string)=>JSON.stringify({version:1,events:f.endsWith('letterboxd-playback-events.json')?events:[]})},path,
 './letterboxdImport':{letterboxdEntryIdentity:(s:string)=>s},
 './letterboxdSyncReceipts':{readSyncReceipts:()=>[]},
 './recentUnratedViewing':{recentUnratedViewing},
 };
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'reviewEntrySelection.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText,{exports,require:(id:string)=>{if(!deps[id])throw Error(id);return deps[id];}});
 return exports;
}
const event={id:'event',userId:1,tmdbId:1,watchedDate:new Date().toISOString().slice(0,10),occurredAt:Date.now()-1000};
test('latest unrated playback is suggested and later rating suppresses it',async()=>{
 assert.equal((await harness([], [event]).latestReviewViewing(1,1,'movie')).suggested,true);
 assert.equal((await harness([{rating:3,publishedAt:new Date(),source:'local'}],[event]).latestReviewViewing(1,1,'movie')).suggested,false);
});
test('explicit consolidated playback preserves remote diary and an associated rating',async()=>{
 const r=await harness([{source:'local',viewingEventId:'event',externalEntryId:'https://letterboxd.com/prplmg/film/iboy/',rating:2,publishedAt:'2020-01-01'}],[event]).latestReviewViewing(1,1,'movie');
 assert.equal(r.source,'letterboxd');assert.equal(r.entryId,'https://letterboxd.com/prplmg/film/iboy/');assert.equal(r.suggested,false);
});
