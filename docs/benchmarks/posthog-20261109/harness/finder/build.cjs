const fs=require('fs'),path=require('path'),esbuild=require('../../../koalasync-fork/node_modules/esbuild');
const root=path.resolve('seerr-weekly-lists'),out=__dirname;
const mocks={
'next/router':'export const useRouter=()=>({isReady:true,pathname:location.pathname,back:()=>history.back()})',

'@app/components/Common/PageTitle':'export default ()=>null',
'@app/hooks/useDiscovery':'export const useDiscoveryPreviewReadOnly=()=>true',
'@app/hooks/useIsTouch':'export const useIsTouch=()=>true',
'@app/hooks/useToasts':'export default ()=>({addToast:()=>{}})',
'@app/hooks/useUser':'export const Permission={},UserType={};export const useUser=()=>({user:{id:1},hasPermission:()=>false})',
'@app/components/Common/CachedImage':'export default ({src,alt,className,style})=><img src={src.includes("x2FJ")?"/arrival.jpg":src.includes("35IU")?"/moon.jpg":src} alt={alt} className={className} style={{...style,width:"100%",height:"100%",objectFit:"cover"}}/>',
'@app/components/Common/Tooltip':'export default ({children})=><>{children}</>',
'@app/components/BlocklistModal':'export default ()=>null',
'@app/components/RequestModal':'export default ()=>null',
'@app/components/SocialPeople':'export default ()=>null',
'next/link':'export default ({children,href,...p})=><a href={href} {...p}>{children}</a>',
'react-intl':'export const FormattedRelativeTime=()=>"2 hours ago";export const defineMessages=x=>x;export const useIntl=()=>({locale:"en",formatMessage:m=>m.defaultMessage||m.id})',
'swr':'export const mutate=()=>{};export default key=>({data:Array.isArray(key)?{searches:[{id:"a",query:"Science fiction movies from 2010 through 2020, under 120 minutes, with a Letterboxd score between 3.5 and 4.5",people:[4],searchedAt:Date.now()}]}:key?{selfId:1,users:[{id:1,name:"prplmg"},{id:4,name:"ykrn"},{id:5,name:"avellana"},{id:6,name:"zelza"},{id:7,name:"margoTica"},{id:8,name:"evegrissel"},{id:9,name:"misu"}]}:undefined,mutate:()=>{}})',
'axios':'export default {post:async (...args)=>window.libraryPost(...args),get:async (...args)=>window.libraryGet(...args),isAxiosError:()=>false}',
};
(async()=>{await esbuild.build({entryPoints:[out+'/preview.tsx'],outfile:out+'/preview.js',bundle:true,minify:true,format:'esm',absWorkingDir:root,tsconfig:root+'/tsconfig.json',nodePaths:[root+'/node_modules'],jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'fixtures',setup(b){b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:a.path.endsWith('.svg')?{path:a.path,namespace:'svg'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path],loader:'jsx',resolveDir:root}));b.onLoad({filter:/.*/,namespace:'svg'},()=>({contents:'export default ()=>null',loader:'jsx',resolveDir:root}));}}]});const postcss=require(root+'/node_modules/postcss'),tw=require(root+'/node_modules/tailwindcss');const css=await postcss([tw({...require(root+'/tailwind.config.js'),content:[root+'/src/pages/ai-search.tsx',root+'/src/pages/find-to-watch.tsx',root+'/src/components/TitleCard/**/*.tsx',root+'/src/components/Common/**/*.tsx',root+'/src/components/AiSearch/**/*.tsx',out+'/preview.tsx']})]).process(fs.readFileSync(root+'/src/styles/globals.css','utf8'),{from:root+'/src/styles/globals.css'});fs.writeFileSync(out+'/preview.css',css.css+'\nbody{background:#111827;font-family:system-ui}ul.cards-vertical{display:grid;gap:16px;grid-template-columns:repeat(auto-fill,minmax(150px,1fr))}');fs.writeFileSync(out+'/index.html','<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="preview.css"><div id="root"></div><script type="module" src="preview.js"></script>');})();
