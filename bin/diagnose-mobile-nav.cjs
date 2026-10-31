// Isolated layout diagnostic; actual Layout/MobileMenu, mocked data-only siblings.
const fs=require('fs'),path=require('path'),ts=require('typescript'),React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
const {chromium}=require('../../seerr-social/letterboxd-pilot/node_modules/playwright');
const out=path.resolve('../outputs/mobile-nav-diagnosis');
function load(file){const api={};new Function('require','exports',ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText)(name=>{
 if(name==='react') return React;
 if(name==='next/router')return {useRouter:()=>({pathname:'/person/1',back(){}})};
 if(name==='next/link')return ({children,...p})=>React.createElement('a',p,children);
 if(name==='swr')return ()=>({data:{}});
 if(name==='react-intl')return {useIntl:()=>({locale:'en',formatMessage:m=>m?.defaultMessage||'Menu'})};
 if(name==='@headlessui/react')return {Transition:()=>null};
 if(name.endsWith('/MobileMenu'))return load('src/components/Layout/MobileMenu/index.tsx').default;
 if(name.endsWith('/Sidebar'))return {default:()=>null,menuMessages:new Proxy({},{get:()=>({defaultMessage:'Menu'})}),__esModule:true};
 if(name.endsWith('/useUser'))return {useUser:()=>({user:{},hasPermission:()=>true}),Permission:{ADMIN:1}};
 if(name.endsWith('/useDiscovery'))return ()=>({enabled:true});
 if(name.endsWith('/useSettings'))return ()=>({currentSettings:{}});
 if(name.endsWith('/useLocale'))return ()=>({});
 if(name.startsWith('@app/'))return ()=>null;
 return require(name);
},api);return api;}
(async()=>{
 const Layout=load('src/components/Layout/index.tsx').default;
 const markup=renderToStaticMarkup(React.createElement(Layout,null,React.createElement('div',{style:{height:4000}},React.createElement('input',{placeholder:'Diagnostic input'}),'Long actor page fixture')));
 const css=fs.readFileSync(path.join(out,'styles.css'),'utf8');
 fs.writeFileSync(path.join(out,'fixture.html'),`<!doctype html><meta name="viewport" content="initial-scale=1, viewport-fit=cover, width=device-width"><style>${css}</style><div id="__next">${markup}</div>`);
 const browser=await chromium.launch({channel:'chrome',headless:true});const rows=[];
 try{for(const reducedMotion of ['no-preference','reduce'])for(const width of [320,390,430]){
 const page=await browser.newPage({viewport:{width,height:844},reducedMotion});
 await page.goto('file://'+path.join(out,'fixture.html'));
 for(const height of [844,450,844]){await page.setViewportSize({width,height});for(const y of [0,600,1200,600,0]){
 await page.evaluate(y=>scrollTo(0,y),y);
 rows.push(await page.evaluate(({width,height,reducedMotion})=>{const bar=document.querySelector('.fixed.bottom-0');const r=bar.getBoundingClientRect();const ancestors=[];for(let e=bar.parentElement;e;e=e.parentElement){let s=getComputedStyle(e);ancestors.push({tag:e.tagName,class:e.className,transform:s.transform,filter:s.filter,backdropFilter:s.backdropFilter,contain:s.contain,willChange:s.willChange,overflow:s.overflow});}return {width,height,reducedMotion,scrollY,bottom:r.bottom,error:r.bottom-innerHeight,position:getComputedStyle(bar).position,ancestors};},{width,height,reducedMotion}));
 }}
 await page.close();
 }}finally{await browser.close();}
 fs.writeFileSync(path.join(out,'measurements.json'),JSON.stringify(rows,null,2));
 console.log(JSON.stringify({cases:rows.length,maxBottomError:Math.max(...rows.map(r=>Math.abs(r.error))),ancestors:rows[0].ancestors},null,2));
 if(rows.some(r=>Math.abs(r.error)>1))process.exitCode=1;
})();
