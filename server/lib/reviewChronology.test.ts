import assert from 'node:assert/strict';
import {it} from 'node:test';
import {DataSource,EntitySchema} from 'typeorm';
import {reviewActivityDate} from './reviewChronology';
it('SQL pagination and date window use watch dates, including delayed publication and undated fallback',async()=>{
 const Row=new EntitySchema<any>({name:'ChronologyReview',columns:{id:{type:String,primary:true},watchedDate:{type:String,nullable:true},publishedAt:{type:String}}});
 const db=new DataSource({type:'sqlite',database:':memory:',entities:[Row],synchronize:true});await db.initialize();
 try {
  const repo=db.getRepository(Row);
  await repo.save([{id:'verity',watchedDate:'2026-10-27',publishedAt:'2026-10-28T00:00:00.000Z'},{id:'today',watchedDate:'2026-10-28',publishedAt:'2026-10-28T00:00:00.000Z'},{id:'backdated',watchedDate:'2026-10-01',publishedAt:'2026-10-28T12:00:00.000Z'},{id:'undated',watchedDate:null,publishedAt:'2026-10-26T12:00:00.000Z'}]);
  const q=repo.createQueryBuilder('review').addSelect(reviewActivityDate,'review_activity_date').where(`${reviewActivityDate} >= :since`,{since:'2026-10-20'}).orderBy('review_activity_date','DESC').addOrderBy('review.publishedAt','DESC').addOrderBy('review.id','ASC');
  const [first,total]=await q.clone().skip(0).take(2).getManyAndCount();assert.equal(total,3);assert.deepEqual(first.map(x=>x.id),['today','verity']);assert.deepEqual((await q.clone().skip(2).take(2).getMany()).map(x=>x.id),['undated']);
 } finally {await db.destroy();}
});
