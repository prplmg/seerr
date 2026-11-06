function anonymousDiscoveryPage() {
  if(document.querySelector('#challenge-form,[name="cf-turnstile-response"]') || /Just a moment|Verify you are human/i.test(document.title))return {error:'challenge'};
  const signIn=Array.from(document.querySelectorAll('a')).some(a=>/sign in/i.test(a.textContent)&&/sign-in|signin|login/.test(a.getAttribute('href')||''));
  if(!signIn||document.querySelector('body.logged-in'))return {error:'anonymous-context-required'};
  const candidates=[];
  for(const heading of document.querySelectorAll('h2,h3')){
    const a=heading.querySelector('a[href*="/list/"]');if(!a)continue;
    const url=new URL(a.getAttribute('href'),location.href).href;
    if(!/^https:\/\/letterboxd\.com\/[a-z0-9_]+\/list\/(?:[a-z0-9-]+|filmlist:[1-9][0-9]*)\/$/i.test(url))continue;
    const card=heading.closest('li')||heading.parentElement;
    const metadata=card.cloneNode(true);for(const h of metadata.querySelectorAll('h2,h3'))h.remove();
    const count=metadata.textContent.match(/([\d,]+)\s*films?\b/i);
    if(!count)return {error:'missing-list-size'};
    candidates.push({url,title:a.textContent.trim().slice(0,500),total:Number(count[1].replaceAll(',',''))});
  }
  if(!candidates.length||candidates.length>100)return {error:'incomplete-discovery'};
  return {url:location.href,anonymous:true,complete:true,candidates};
}
// Read-only public-list adapter. Only an explicitly permitted InPrivate window
// can establish public visibility; authenticated tabs are never used as proof.
function anonymousListPage() {
  if(document.querySelector('#challenge-form,[name="cf-turnstile-response"]')||/Just a moment|Verify you are human/i.test(document.title))return {error:'challenge'};
  const signIn=Array.from(document.querySelectorAll('a')).some(a=>/sign in/i.test(a.textContent)&&/sign-in|signin|login/.test(a.getAttribute('href')||''));
  if(!signIn||document.querySelector('body.logged-in'))return {error:'anonymous-list-not-ready'};
  const canonical=document.querySelector('link[rel="canonical"]')?.href||document.querySelector('meta[property="og:url"]')?.content;
  if(!canonical)return {error:'anonymous-list-not-ready'};
  const root=new URL(canonical,location.href);
  root.pathname=root.pathname.replace(/page\/\d+\/$/,'');
  if(root.origin!=='https://letterboxd.com'||!/^\/[a-z0-9_]+\/list\/(?:[a-z0-9-]+|filmlist:[1-9][0-9]*)\/$/i.test(root.pathname)||root.search||root.hash)return {error:'invalid-list-page'};
  if(location.origin!==root.origin||!(location.pathname===root.pathname||new RegExp('^'+root.pathname+'page/[1-9][0-9]*/$').test(location.pathname)))return {error:'invalid-list-page'};
  const description=document.querySelector('meta[name="description"]')?.content||'';
  const count=description.match(/(?:list of\s+)?([\d,]+) films?\b/i);
  if(!count)return {error:'anonymous-list-not-ready'};
  const total=Number(count[1].replaceAll(',',''));if(total>10000)return {error:'list-too-large'};
  const title=(document.querySelector('h1.list-title,h1.title-1')?.textContent||document.querySelector('meta[property="og:title"]')?.content||'').trim().slice(0,500);
  if(!title)return {error:'anonymous-list-not-ready'};
  const text=node=>{if(!node)return '';const clone=node.cloneNode(true);for(const br of clone.querySelectorAll('br'))br.replaceWith('\n');for(const p of clone.querySelectorAll('p'))p.append('\n\n');return clone.textContent.trim().slice(0,20000);};
  const items=[],seen=new Set();
  for(const node of document.querySelectorAll('.poster-list [data-film-slug],.poster-list [data-item-slug],.grid [data-film-slug],.grid [data-item-slug]')){
    const slug=node.dataset.filmSlug||node.dataset.itemSlug;
    if(!/^(?:[a-z0-9-]+|film:[1-9][0-9]*)$/i.test(slug))return {error:'invalid-list-page'};
    if(seen.has(slug))continue;seen.add(slug);
    items.push({url:`https://letterboxd.com/film/${slug}/`,title:(node.dataset.filmName||node.dataset.itemName||node.querySelector('img')?.alt||slug).slice(0,500),year:'',note:text(node.closest('li')?.querySelector('.body-text'))});
  }
  if(!items.length&&(total!==0||!document.querySelector('.empty-text')))return {error:'anonymous-list-not-ready'};
  const nextLink=document.querySelector('a.next,.paginate-next a');
  const next=nextLink?new URL(nextLink.getAttribute('href'),location.href):null;
  if(next&&(next.origin!==root.origin||next.search||next.hash||!new RegExp('^'+root.pathname+'page/[1-9][0-9]*/$').test(next.pathname)))return {error:'invalid-list-page'};
  return {url:root.href,title,description:text(document.querySelector('.list-description,.body-text[data-full-text-url="#list-notes"]')),total,items,next:next?.href||null};
}
async function scanAnonymousList(chrome,url,progress,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)), options={}) {
  const discovery=options.mode==='discovery';
  const validDiscovery=/^https:\/\/letterboxd\.com\/lists\/popular\/(?:this\/(?:week|month|year)\/)?(?:page\/2\/)?$/.test(url);
  if(!(discovery&&validDiscovery)&&!/^https:\/\/(?:letterboxd\.com\/[a-z0-9_]+\/list\/(?:[a-z0-9-]+|filmlist:[1-9][0-9]*)\/|boxd\.it\/[a-z0-9]+\/?)$/i.test(url))throw Error('invalid-list-url');
  const permitted=await new Promise(resolve=>chrome.extension.isAllowedIncognitoAccess(resolve));
  if(!permitted)throw Error('incognito-access-required');
  let window;
  try{
    window=await chrome.windows.create({url:'about:blank',incognito:true,focused:false});
    const tab=window.tabs?.[0];if(!window.incognito||!tab?.incognito)throw Error('anonymous-context-required');
    let current=url,snapshot;const pages=new Set(),films=new Set();
    while(current){
      if(pages.has(current)||pages.size>=100)throw Error('incomplete-list');pages.add(current);
      await chrome.tabs.update(tab.id,{url:current});
      let page;
      for(let attempt=0;attempt<30;attempt++){
        await wait(500);
        try{const [r]=await chrome.scripting.executeScript({target:{tabId:tab.id},func:discovery?anonymousDiscoveryPage:anonymousListPage});page=r?.result;}catch{continue;}
        if(page?.error==='challenge')throw Error('challenge');
        if(page&&!page.error)break;
      }
      if(!page||page.error)throw Error('incomplete-list');
      if(discovery){if(page.url!==url)throw Error('discovery-identity-changed');return page;}
      if(page.total>(options.maxFilms||10000))throw Error('list-too-large');
      if(!snapshot){if(url.startsWith('https://letterboxd.com/')&&page.url!==url)throw Error('list-identity-changed');snapshot={url:page.url,title:page.title,description:page.description,total:page.total,items:[],anonymous:true,complete:true};}
      if(page.url!==snapshot.url||page.total!==snapshot.total)throw Error('list-changed');
      for(const row of page.items){if(films.has(row.url))throw Error('duplicate-list-film');films.add(row.url);snapshot.items.push(row);}
      if(snapshot.items.length>10000||new TextEncoder().encode(JSON.stringify(snapshot)).length>4*1024*1024)throw Error('list-too-large');
      await progress({stage:'public-list-page',tabId:tab.id});current=page.next;
    }
    if(snapshot.items.length!==snapshot.total)throw Error('incomplete-list');
    return snapshot;
  }finally{if(window?.id!=null)try{await chrome.windows.remove(window.id);}catch{}}
}
if(typeof module!=='undefined')module.exports={scanAnonymousList,anonymousListPage,anonymousDiscoveryPage};
