import test from 'node:test';
import assert from 'node:assert/strict';
import {localDay,reviewKey,practicePlan,reviewed,difficultyOf} from '../public/practice.js';
import {snapshotRecords,recordsSnapshot,emptySnapshot} from '../public/sync-core.js';
const words=Array.from({length:20},(_,i)=>({id:`word-${i}`,text:`ord${i}`}));
test('daily deck prioritizes hard, medium and easy and excludes words already reviewed today',()=>{
 const day='2026-11-26',settings={practiceDailyLimit:5},entries=words.slice(0,4);
 for(const [i,difficulty] of [[0,'easy'],[1,'medium'],[2,'hard'],[3,'hard']])settings[reviewKey(entries[i].id)]={difficulty,lastReviewedAt:`2026-11-2${i}T12:00:00Z`};
 assert.deepEqual(practicePlan(entries,settings,day).ids,['word-2','word-3','word-1','word-0']);
 settings[reviewKey('word-2')].completedDay=day;const plan=practicePlan(entries,settings,day);assert.equal(plan.completed,1);assert.deepEqual(plan.ids,['word-3','word-1','word-0']);
 assert.equal(practicePlan([],settings,day).ids.length,0);assert.equal(practicePlan(words,{practiceDailyLimit:1000},day).limit,100);
});
test('three ratings complete today and become eligible tomorrow, preserving difficulty',()=>{
 const date=new Date(2026,10,26,23,59),day=localDay(date);
 for(const difficulty of ['hard','medium','easy']){const review=reviewed({interval:30,dueDay:'2027-01-01'},difficulty,date);assert.equal(review.difficulty,difficulty);assert.equal(review.completedDay,day);assert.equal(review.interval,undefined);assert.equal(review.dueDay,undefined);const settings={[reviewKey(words[0].id)]:review};assert.equal(practicePlan([words[0]],settings,day).ids.length,0);assert.deepEqual(practicePlan([words[0]],settings,'2026-11-27').ids,['word-0']);}
 assert.throws(()=>reviewed({},'invalid'),/Choose/);assert.equal(difficultyOf(undefined),'medium');assert.equal(difficultyOf({interval:0,lastReviewedAt:date.toISOString()}),'hard');
});
test('daily sampling is stable, capped, and rotates older words within each group',()=>{
 const settings={practiceDailyLimit:5},day='2026-11-26',first=practicePlan(words,settings,day);assert.equal(first.ids.length,5);assert.equal(new Set(first.ids).size,5);assert.deepEqual(practicePlan(words,settings,day),first);
 for(const id of first.ids)settings[reviewKey(id)]=reviewed({},'medium',new Date(2026,10,26,12));
 assert.equal(practicePlan(words,settings,day).ids.length,0);assert.equal(practicePlan(words,settings,day).completed,5);assert.ok(practicePlan(words,settings,'2026-11-27').ids.every(id=>!first.ids.includes(id)));
});
test('groups and daily progress round-trip through separate existing sync records',()=>{
 const snapshot=emptySnapshot();snapshot.entries=words;snapshot.evaluation.practiceDailyLimit=5;snapshot.evaluation[reviewKey(words[0].id)]=reviewed({},'hard',new Date(2026,10,26));snapshot.evaluation[reviewKey(words[1].id)]=reviewed({},'easy',new Date(2026,10,26));
 const rows=snapshotRecords(snapshot);assert.ok(rows.has('user_settings/practice:word-0'));assert.ok(rows.has('user_settings/practice:word-1'));const restored=recordsSnapshot(rows);assert.deepEqual(restored.evaluation,snapshot.evaluation);assert.deepEqual(practicePlan(restored.entries,restored.evaluation,'2026-11-27'),practicePlan(words,snapshot.evaluation,'2026-11-27'));
});
