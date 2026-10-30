import assert from 'node:assert/strict';
import { test } from 'node:test';
import { recentUnratedViewing as eligible } from './recentUnratedViewing';
const now=Date.parse('2026-10-30T12:00:00Z'), viewing={date:'2026-10-29',occurredAt:now-86400000};
test('recent unrated viewing defaults, including an older rating before a rewatch',()=>{
 assert.equal(eligible(viewing,[],now),true);
 assert.equal(eligible(viewing,[{rating:3,publishedAt:new Date(now-2*86400000)}],now),true);
 assert.equal(eligible(viewing,[{rating:null,publishedAt:new Date(now)}],now),true);
});
test('ratings at or after viewing suppress the default',()=>{
 for(const publishedAt of [new Date(viewing.occurredAt),new Date(now)])assert.equal(eligible(viewing,[{rating:2,publishedAt}],now),false);
});
test('30 day boundary, missing and future viewing',()=>{
 assert.equal(eligible({...viewing,occurredAt:now-30*86400000},[],now),true);
 assert.equal(eligible({...viewing,occurredAt:now-30*86400000-1},[],now),false);
 assert.equal(eligible(null,[],now),false);
 assert.equal(eligible({...viewing,occurredAt:now+1},[],now),false);
 assert.equal(eligible({date:'bad'},[],now),false);
 assert.equal(eligible({date:'2026-10-29'},[],now),true);
});
