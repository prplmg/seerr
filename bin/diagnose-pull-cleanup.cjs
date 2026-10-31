const fs=require('fs'),ts=require('typescript');const listeners=new Map();let cleanup;
global.window={scrollY:0,scrollX:0,addEventListener:(n,f)=>listeners.set(n,f),removeEventListener:n=>listeners.delete(n)};
const body={style:{}},html={style:{}};global.document={body,querySelector:()=>html};
const api={};new Function('require','exports',ts.transpileModule(fs.readFileSync('src/components/Layout/PullToRefresh/index.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText)(name=>{
 if(name==='react')return {useEffect:f=>{cleanup=f()},useRef:()=>({current:null}),useState:v=>[v,()=>{}]};
 if(name==='next/router')return {useRouter:()=>({reload(){}})};
 return require(name);
},api);
api.default();listeners.get('touchstart')({targetTouches:[{screenY:300}]});
const afterStart=JSON.parse(JSON.stringify({body:body.style,html:html.style}));
const handlesCancel=listeners.has('touchcancel');cleanup();
console.log(JSON.stringify({afterStart,handlesCancel,afterUnmount:{body:body.style,html:html.style}},null,2));
