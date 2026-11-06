const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const context={URL,TextEncoder,setTimeout};vm.createContext(context);vm.runInContext(fs.readFileSync(__dirname+'/list-browser.js','utf8'),context);
const {scanAnonymousList}=context;
const root='https://letterboxd.com/alice/list/test/';
function fixture({allowed=true,pages,incognito=true}={}){
 let index=-1,closed=0,opened=0;const visits=[];
 const chrome={extension:{isAllowedIncognitoAccess:cb=>cb(allowed)},windows:{create:async()=>{opened++;return {id:1,incognito,tabs:[{id:2,incognito}]};},remove:async id=>{assert.equal(id,1);closed++;}},tabs:{update:async(id,{url})=>{visits.push(url);index++;}},scripting:{executeScript:async()=>[{result:pages[index]}]}};
 return{chrome,visits,closed:()=>closed,opened:()=>opened};
}
const row=slug=>({url:`https://letterboxd.com/film/${slug}/`,title:slug,year:'',note:''});
test('DOM reader recognizes numeric Letterboxd film identities and rejects malformed ones',()=>{
 let slug='film:636498';
 const ctx={URL,location:new URL(root),document:{title:'List',
  querySelector:s=>s==='meta[property="og:url"]'?{content:root}:s==='meta[name="description"]'?{content:'A list of 1 films'}:s==='h1.list-title,h1.title-1'?{textContent:'List'}:null,
  querySelectorAll:s=>s==='a'?[{textContent:'Sign in',getAttribute:()=>'/sign-in/'}]:[{dataset:{get itemSlug(){return slug},itemName:'Sol'},closest:()=>null}]
 }};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync(__dirname+'/list-browser.js','utf8'),ctx);
 assert.equal(ctx.anonymousListPage().items[0].url,'https://letterboxd.com/film/film:636498/');
 for(slug of ['film:0','film:abc','film:42/other'])assert.equal(ctx.anonymousListPage().error,'invalid-list-page');
});
test('anonymous paginated scan closes its own window and returns complete ordered data',async()=>{
 const f=fixture({pages:[{url:root,title:'List',description:'',total:2,items:[row('jaws')],next:root+'page/2/'},{url:root,title:'List',description:'',total:2,items:[row('alien')],next:null}]});
 const result=await scanAnonymousList(f.chrome,root,async()=>{},async()=>{});
 assert.deepEqual(Array.from(result.items,r=>r.title),['jaws','alien']);assert.equal(result.anonymous,true);assert.equal(f.closed(),1);
});
test('permission denied never opens a window; normal context never reads private data',async()=>{
 const denied=fixture({allowed:false});await assert.rejects(scanAnonymousList(denied.chrome,root,async()=>{}),/incognito-access-required/);assert.equal(denied.opened(),0);
 const normal=fixture({incognito:false});await assert.rejects(scanAnonymousList(normal.chrome,root,async()=>{}),/anonymous-context-required/);assert.equal(normal.closed(),1);
});
test('challenge, duplicates and incomplete totals fail closed and always close the window',async()=>{
 for(const pages of [[{error:'challenge'}],[{url:root,total:2,items:[row('jaws')],next:null}],[{url:root,total:2,items:[row('jaws'),row('jaws')],next:null}]]){
  const f=fixture({pages});await assert.rejects(scanAnonymousList(f.chrome,root,async()=>{},async()=>{}));assert.equal(f.closed(),1);
 }
});
test('weekly scan rejects list growth above 560 before following any extra pages',async()=>{
 const f=fixture({pages:[{url:root,title:'Large',description:'',total:561,items:[row('jaws')],next:root+'page/2/'}]});
 await assert.rejects(scanAnonymousList(f.chrome,root,async()=>{},async()=>{},{mode:'contents',maxFilms:560}),/list-too-large/);
 assert.equal(f.visits.length,1);assert.equal(f.closed(),1);
});
test('discovery reads only an allowlisted page and returns a complete anonymous census',async()=>{
 const url='https://letterboxd.com/lists/popular/this/week/page/2/';
 const f=fixture({pages:[{url,anonymous:true,complete:true,candidates:[{url:root,title:'Example',total:560}]}]});
 const result=await scanAnonymousList(f.chrome,url,async()=>{},async()=>{},{mode:'discovery',maxFilms:560});
 assert.equal(result.candidates[0].total,560);assert.equal(f.closed(),1);
 await assert.rejects(scanAnonymousList(f.chrome,'https://letterboxd.com/settings/',async()=>{},async()=>{},{mode:'discovery'}),/invalid-list-url/);
});
