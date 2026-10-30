// Actual composer markup with offline data; never connects to live accounts.
const fs=require('fs'),path=require('path'),ts=require('typescript'),React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
const {chromium}=require('../../seerr-social/letterboxd-pilot/node_modules/playwright');
const out=path.resolve(process.argv[2]||'../outputs/review-sync-layout');
fs.mkdirSync(out,{recursive:true});
let hook=0;
let previewRating="";
const review={id:'local:1:1',userId:1,tmdbId:1,mediaType:'movie',source:'local',rating:2.5,text:'',spoiler:false,syncedToLetterboxd:true,publishedAt:'2026-10-19',user:{id:1,name:'prplmg'}};
function load(file){const api={};const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
new Function('require','exports',code)(name=>{
 if(name==='react')return {...React,useState:initial=>React.useState(++hook===2?true:initial)};
 if(name==='swr')return Object.assign(url=>({data:url?.includes('/mine/')?{review,entries:[review],latestViewing:{id:'viewing',date:'2026-10-18',source:'letterboxd',entryId:'https://letterboxd.com/prplmg/film/example/'},publishing:{enabled:true,schedule:{times:['09:00','21:00'],timeZone:'America/Merida'}}}:{results:[review],total:1},mutate:async()=>{}}),{useSWRConfig:()=>({mutate:async()=>{}})});
 if(name.endsWith('/useUser'))return {useUser:()=>({user:{id:1}})};
 if(name==='next/router')return {useRouter:()=>({asPath:'/movie/1'})};
 if(name.endsWith('/messages'))return {usePartyText:()=>en=>en};
 if(name.endsWith('/Button'))return ({children,buttonType,...props})=>React.createElement('button',{...props,className:'rounded border border-gray-600 px-4 py-2'},children);
 if(name.endsWith('/CachedImage'))return ({type,...props})=>React.createElement('img',props);
 if(name.endsWith('/StarPicker'))return props=>React.createElement(load('src/components/Reviews/StarPicker.tsx').default,{...props,value:previewRating});
 if(name==='next/link')return ({children,...props})=>React.createElement('a',props,children);
 if(name.startsWith('@app/'))return {};
 return require(name);
},api);return api;}
(async()=>{
 const {MovieReviews}=load('src/components/Reviews/index.tsx');
 const css=fs.readFileSync(path.join(out,'styles.css'),'utf8');
 const browser=await chromium.launch({channel:'chrome',headless:true});
 const results=[];
 try {for(const width of [320,375,390,768,1440]){
 const positions=[];
 for(const rating of ["","2","4.5"]){ previewRating=rating;
  hook=0;const html=renderToStaticMarkup(React.createElement(MovieReviews,{movieId:1}));
  const page=await browser.newPage({viewport:{width,height:1100}});
  await page.setContent(`<html><head><style>${css}</style></head><body class="bg-gray-900 p-4 text-white"><main class="mx-auto max-w-4xl">${html}</main></body></html>`);
  positions.push(await page.locator('form select').evaluate(e=>e.getBoundingClientRect().top));
  await page.locator('form textarea').focus();
  await page.setViewportSize({width,height:450});
  if(width===390&&rating==='2')await page.screenshot({path:path.join(out,'390-focused.png'),fullPage:true});
  await page.setViewportSize({width,height:1100});
  await page.screenshot({path:path.join(out,`${width}-${rating||'empty'}.png`),fullPage:true});
  results.push(await page.evaluate(()=>({width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,viewingOptions:[...document.querySelectorAll('select option')].map(o=>o.textContent),synced:document.body.innerText.includes('Synced with Letterboxd'),reviewFields:document.querySelectorAll('form textarea').length, controlFont:Math.min(...[...document.querySelectorAll('form select,form textarea')].map(e=>parseFloat(getComputedStyle(e).fontSize))),viewingLabels:[...document.querySelectorAll('form label')].filter(e=>e.textContent.includes('Associate with a viewing')).length, viewingFields:document.querySelectorAll('form select').length, clippedFields:[...document.querySelectorAll('form textarea, form select, form input')].filter(e=>{const r=e.getBoundingClientRect(),f=e.closest('form').getBoundingClientRect();return r.left<f.left||r.right>f.right||r.width===0||r.height===0}).length})));
  await page.close();
 }
 if(Math.max(...positions)-Math.min(...positions)>1)throw Error('Rating changes shift viewing field');
 }}finally{await browser.close();}
 fs.writeFileSync(path.join(out,'measurements.json'),JSON.stringify(results,null,2));
 console.log(results);
 if(results.some(r=>r.controlFont<16||r.viewingLabels!==1||r.overflow||!r.synced||r.reviewFields!==1||r.viewingFields!==1||r.clippedFields>0||!r.viewingOptions.length))throw Error('Composer layout failed');
})().catch(error=>{console.error(error);process.exitCode=1;});
