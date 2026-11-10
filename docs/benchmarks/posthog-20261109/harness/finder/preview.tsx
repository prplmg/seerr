import {suggestAiSort,sortSearchResults} from '@server/lib/aiSearchSort';
import React from 'react';
import {SparklesIcon,HeartIcon,UsersIcon,BookmarkIcon,EllipsisHorizontalIcon} from '@heroicons/react/24/outline';
import {createRoot} from 'react-dom/client';
import AiSearch from '@app/pages/ai-search';
import FindToWatch from '@app/pages/find-to-watch';
const films=[['Arrival',2016,'/x2FJsf1ElAgr63Y3PNPtJrcmpoe.jpg','Thoughtful first contact with emotional stakes'],['Moon',2009,'/35IU0Mq0zFsN1mYwDGts5mKc77n.jpg','Lonely lunar mystery questions personal identity'],['Ex Machina',2015,'/btbRB7BrD887j5NrvjxceRDmaot.jpg','Intimate AI thriller with uneasy intimacy'],['Coherence',2013,'/ezbjsqwL1zstDGA2IRy2Dl1hVxN.jpg','Dinner-party paranoia meets fractured realities']];
window.fixture={filters:{type:'movie',available:false,unwatched:false,maxRuntime:null,yearFrom:null,yearTo:null,genres:[],minLetterboxdRating:4},note:'',people:[{id:1,name:'prplmg'}],results:Array.from({length:120},(_,i)=>films[i%2]).map(([title,year,poster,reason],i)=>({letterboxdRating:4.2,runtime:116,media:{id:i+1,mediaType:'movie',title,releaseDate:year+'-01-01',posterPath:poster,overview:'Mocked result for layout review.',voteAverage:8,mediaInfo:{status:5}},reason}))};
const originalFetch = window.fetch;
window.fetch = async (url, init) => {
 if(url !== '/api/v1/ai-search') return originalFetch(url, init);
 const body = JSON.parse(init.body); window.lastRequest=body; window.mockCalls=(window.mockCalls||0)+1;
 return new Response(new ReadableStream({start(controller){
  const emit=event=>controller.enqueue(new TextEncoder().encode(JSON.stringify(event)+'\n'));
  emit({kind:'progress',message:body.filters?'Reusing your search…':'Understanding your search…'});
  setTimeout(()=>emit({kind:'progress',message:'Finding movies…'}),500);
  setTimeout(()=>emit({kind:'progress',message:body.filters?.minLetterboxdRating != null ? 'Checking Letterboxd ratings… 8/20' : 'Checking runtimes…'}),1000);
  setTimeout(()=>{emit({kind:'result',data:{...window.fixture,people:[{id:1,name:'prplmg'},...(body.people||[]).map(id=>({id,name:'Viewer'}))],sort:body.sort??suggestAiSort(body.query,window.fixture.filters),suggestedSort:suggestAiSort(body.query,window.fixture.filters),filters:body.filters||window.fixture.filters,results:sortSearchResults(window.fixture.results,body.sort??suggestAiSort(body.query,window.fixture.filters)).map(row=>({...row,letterboxdRating:row.letterboxdRating}))}});controller.close();},3000);
 }}));
};

if(!history.state?.key) history.replaceState({key:crypto.randomUUID()},'');
window.navigate = (url) => {history.pushState({key:crypto.randomUUID()},'',url);window.dispatchEvent(new Event('preview-route'));};
function Shell(){const [route,setRoute]=React.useState(location.pathname);React.useEffect(()=>{const update=()=>setRoute(location.pathname);addEventListener('popstate',update);addEventListener('preview-route',update);return()=>{removeEventListener('popstate',update);removeEventListener('preview-route',update)}},[]);return <div className="p-4 text-gray-100"><nav className="hidden"><button onClick={()=>history.back()}>App back</button><button onClick={()=>window.navigate('/ai-search')}>AI shortcut</button><button onClick={()=>window.navigate('/movie/1')}>Open result</button></nav>{route==='/find-to-watch'?<FindToWatch/>:route==='/ai-search'?<AiSearch key={history.state.key}/>:<h1>Movie detail fixture</h1>}</div>}
createRoot(document.getElementById('root')!).render(<Shell/>);

let ticket=0;
window.libraryPost=async(url,body)=>{
 window.libraryCalls=(window.libraryCalls||0)+1;window.lastLibraryRequest=body;
 const id=String(++ticket);window.libraryBody=body;
 return {data:{id,ready:false,message:body.filters.maxRuntime?'Checking runtimes and title details… 12/24':'Checking title details… 12/24'}};
};
window.libraryGet=async()=>({data:{id:String(ticket),ready:true,message:'Ready',results:window.fixture.results,total:120,next:null,unknown:0}});
