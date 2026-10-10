const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const compile = file => ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
async function main() {
  let response, request;
  class ExternalAPI { async get(...args) { request = args; return response; } }
  const exports = {};
  vm.runInNewContext(compile('server/api/plextv.ts'), { exports, require(name) {
    if(name.endsWith('/externalapi')) return { default: ExternalAPI };
    if(name.endsWith('/cache')) return { default: { getCache: () => ({data: {}}) } };
    return {};
  } });
  const api = new exports.default('not-a-real-token');
  for(const [type,slug,prefix] of [['movie','lilo-and-stitch','movie'],['tv','elementary','show']]) {
    response = { MediaContainer: { Metadata: [{ type: prefix, slug }] } };
    const url = await api.getPublicWatchUrl(11544,type);
    assert.equal(url,`https://watch.plex.tv/${prefix}/${slug}?autoPlay=1`);
    assert.equal(request[1].params.guid,'tmdb://11544');
    assert.equal(request[1].params.type,type === 'movie' ? 1 : 2);
    assert.equal(request[2],86400);
    assert.ok(!url.includes('viewOffset') && !url.includes('token'));
  }
  for(const matches of [[],[{slug:'x',type:'movie'},{slug:'y',type:'movie'}],[{slug:'../evil',type:'movie'}],[{slug:'x',type:'show'}]]) {
    response={MediaContainer:{Metadata:matches}}; assert.equal(await api.getPublicWatchUrl(1,'movie'),null);
  }
  for(const [ua,touch,mobile] of [['iPhone',0,true],['Android',0,true],['Macintosh',5,true],['Macintosh',0,false],['Windows',0,false]]) {
    let state=false,key; const effects=[]; const out={};
    vm.runInNewContext(compile('src/hooks/useDeepLinks.ts'), { exports:out,navigator:{userAgent:ua,maxTouchPoints:touch}, require(name) {
      if(name === 'react') return {useState:()=>[state,v=>{state=v;}],useEffect:f=>effects.push(f)};
      if(name === 'swr') return {default:k=>{key=k;return {data:k?{url:'https://watch.plex.tv/movie/test?autoPlay=1'}:undefined}}};
      if(name.endsWith('/useSettings')) return {default:()=>({currentSettings:{mediaServerType:1}})};
      if(name.endsWith('/server')) return {MediaServerType:{PLEX:1}};
      throw Error(name);
    }});
    const args={mediaId:2,mediaUrl:'https://app.plex.tv/library',mediaUrl4k:'https://app.plex.tv/4k',iOSPlexUrl:'plex://broken'};
    out.default(args); effects.forEach(f=>f()); const result=out.default(args);
    assert.equal(Boolean(key),mobile);
    assert.equal(result.mediaUrl,mobile?'https://watch.plex.tv/movie/test?autoPlay=1':args.mediaUrl);
  }
  console.log('PASS: canonical movie/show links, no offset/token, ambiguous matches rejected, mobile and desktop routing');
}
main().catch(e=>{console.error(e);process.exitCode=1});
