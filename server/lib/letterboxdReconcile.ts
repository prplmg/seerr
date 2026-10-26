export type ReviewFields={rating:number|null;text:string;spoiler:boolean};
const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
// Text + spoiler are one indivisible edit. No last-writer-wins timestamps:
// an RSS publication date is not an authoritative edit revision.
export function reconcileLetterboxdReview(base:ReviewFields|null,local:ReviewFields|null,remote:ReviewFields|null){
 if(!base)return {state:'needs-baseline' as const,conflicts:[] as string[]};
 if(!local||!remote)return {state:'conflict' as const,conflicts:['deletion']};
 const fields=(r:ReviewFields)=>({rating:r.rating,text:r.text,spoiler:r.spoiler});
 const merged=fields(base);const conflicts:string[]=[];
 for(const group of [['rating'],['text','spoiler']] as const){
  const pick=(value:ReviewFields)=>group.map(key=>value[key]);
  const a=pick(base),b=pick(local),c=pick(remote);
  if(!equal(a,b)&&!equal(a,c)&&!equal(b,c)){conflicts.push(group.join('+'));continue;}
  const from=!equal(a,b)?local:remote;
  for(const key of group)Object.assign(merged,{[key]:from[key]});
 }
 return conflicts.length?{state:'conflict' as const,conflicts}:{state:'ready' as const,conflicts,merged,outgoing:!equal(merged,fields(remote)),incoming:!equal(merged,fields(local))};
}
