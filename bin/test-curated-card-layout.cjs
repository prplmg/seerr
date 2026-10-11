const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict'),ts=require('typescript'),path=require('path');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'src/components/Discover/Curated/index.tsx'),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText+'\nexports.testCard=CategoryCard;';
for(const locale of ['en','es-MX']){
 const out={},state=[],effects=[];let cursor=0,queries=[];
 let fixture={backdropPath:null,posterPath:'/poster.jpg'};
 vm.runInNewContext(compiled,{exports:out,require(name){
  if(name==='react')return {useState(initial){const i=cursor++;if(!(i in state))state[i]=initial;return[state[i],v=>state[i]=typeof v==='function'?v(state[i]):v]},useEffect:f=>effects.push(f)};
  if(name==='react/jsx-runtime')return {jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};
  if(name==='react-intl')return {useIntl:()=>({locale})};
  if(name==='react-intersection-observer')return {useInView:()=>({ref:()=>{},inView:true})};
  if(name==='swr')return {default:key=>{queries.push(key);return{data:fixture}}};
  return new Proxy({default:name},{get:(obj,key)=>obj[key]||String(key)});
 }});
 const category={id:'test',title:{en:'Full long title',es:'Título completo'},description:{en:'Full description',es:'Descripción completa'},cover:{type:'movie',tmdbId:1},covers:[{type:'movie',tmdbId:1},{type:'movie',tmdbId:2}]};
 const render=()=>{cursor=0;return out.testCard({category})};
 let tree=render();assert.ok(tree.props.className.includes('whitespace-normal'));assert.ok(tree.props.className.includes('min-h-48'));assert.ok(!tree.props.className.includes('flex h-48'));
 assert.ok(JSON.stringify(tree).includes('/poster.jpg'));assert.ok(JSON.stringify(tree).includes(locale==='en'?'Full description':'Descripción completa'));assert.ok(!JSON.stringify(tree).includes('line-clamp'));
 fixture={};effects.length=0;render();effects.forEach(f=>f());render();assert.equal(queries.at(-1),'/api/v1/movie/2');
}
assert.ok(!source.includes('RandomPickButton'));
assert.ok(source.includes('className="slider-header"'));
assert.ok(fs.readFileSync(path.join(root,'src/components/Discover/RecentlyAddedSlider/index.tsx'),'utf8').includes('<RandomPickButton />'));
console.log('PASS: full wrapping copy, minimum height, poster and next-title fallbacks, standard spacing, random button moved; EN/ES');
