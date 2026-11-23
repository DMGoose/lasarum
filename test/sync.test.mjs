import test from 'node:test';
import assert from 'node:assert/strict';
import {indexedDB} from 'fake-indexeddb';
import {SyncEngine} from '../public/sync.js';
import {LocalDatabase} from '../public/local-db.js';
import {emptySnapshot,clone,recordKey,validateBackup,mergeBackup} from '../public/sync-core.js';
const word={id:'s1:3:3',text:'stilla',context:'En stilla morgon.',note:'',translation:'calm',explanation:'old'};
class MemoryDB{constructor(){this.accounts=new Map();}async load(id){return clone(this.accounts.get(id));}async save(id,data){this.accounts.set(id,clone(data));}}
class Remote{
 constructor(){this.rows=new Map();this.receipts=new Map();this.lost=false;}
 async index(){return [...this.rows.values()].map(({kind,id,version})=>({kind,id,version}));}
 async read(headers){return headers.map(h=>clone(this.rows.get(recordKey(h.kind,h.id))));}
 async apply(op){
   if(this.receipts.has(op.opId))return clone(this.receipts.get(op.opId));
   const key=recordKey(op.kind,op.id),old=this.rows.get(key);
   if((old?.version||0)!==op.baseVersion)return {status:'conflict',record:clone(old||null)};
   const record={kind:op.kind,id:op.id,version:(old?.version||0)+1,data:{...old?.data,...clone(op.patch)}};
   this.rows.set(key,record);const answer={status:'applied',record};this.receipts.set(op.opId,clone(answer));
   if(this.lost){this.lost=false;throw new Error('Response lost after commit');}return clone(answer);
 }
}
async function devices(){const remote=new Remote(),db=new MemoryDB(),a=new SyncEngine({account:'owner',remote,db}),b=new SyncEngine({account:'owner',remote,db:new MemoryDB()});await a.start();const base=emptySnapshot();base.entries=[clone(word)];await a.save(base);await a.sync();await b.start();await b.sync();return {a,b,remote,db};}
test('two devices merge independent word fields without overwriting a note',async()=>{
 const {a,b,remote}=await devices();const first=clone(a.state.snapshot);first.entries[0].aiExplanation={example:'En stilla kväll.'};await a.save(first);await a.sync();
 const second=clone(b.state.snapshot);second.entries[0].note='My Swedish memory';await b.save(second);await b.sync();
 const result=remote.rows.get('vocabulary/s1:3:3').data;assert.equal(result.note,'My Swedish memory');assert.equal(result.aiExplanation.example,'En stilla kväll.');assert.equal(b.state.conflicts.length,0);
 await a.sync();assert.equal(a.state.snapshot.entries[0].note,'My Swedish memory');
});
test('simultaneous note edits preserve the local draft and require explicit conflict resolution',async()=>{
 const {a,b,remote}=await devices();const first=clone(a.state.snapshot),second=clone(b.state.snapshot);first.entries[0].note='Computer note';second.entries[0].note='Phone note';
 await a.save(first);await b.save(second);await a.sync();await b.sync();
 assert.equal(b.state.conflicts.length,1);assert.equal(b.state.snapshot.entries[0].note,'Phone note');assert.equal(remote.rows.get('vocabulary/s1:3:3').data.note,'Computer note');
 await b.resolve('vocabulary',word.id,'mine');await b.sync();await a.sync();assert.equal(a.state.snapshot.entries[0].note,'Phone note');
});
test('an old device cannot silently resurrect a lookup deleted on another device',async()=>{
 const {a,b,remote}=await devices();const removed=clone(a.state.snapshot);removed.entries=[];await a.save(removed);await a.sync();
 const old=clone(b.state.snapshot);old.entries[0].note='Offline draft';await b.save(old);await b.sync();
 assert.equal(b.state.conflicts.length,1);assert.ok(remote.rows.get('vocabulary/s1:3:3').data.deletedAt);assert.equal(b.state.snapshot.entries[0].note,'Offline draft');
 await b.resolve('vocabulary',word.id,'cloud');assert.equal(b.state.snapshot.entries.length,0);
});
test('lost responses are retried idempotently and later typing does not mutate an attempted operation',async()=>{
 const {a,remote}=await devices();const first=clone(a.state.snapshot);first.entries[0].note='first';await a.save(first);remote.lost=true;await a.sync();
 const attempted=a.state.pending[0].opId,second=clone(a.state.snapshot);second.entries[0].note='second';await a.save(second);
 assert.equal(a.state.pending.length,2);assert.equal(a.state.pending[0].opId,attempted);
 await a.sync();assert.equal(remote.rows.get('vocabulary/s1:3:3').data.note,'second');assert.equal(a.state.pending.length,0);
});
test('rapid unsent note edits coalesce and survive an application restart',async()=>{
 const {a,db,remote}=await devices();for(const note of ['a','ab','abc']){const next=clone(a.state.snapshot);next.entries[0].note=note;await a.save(next);}
 assert.equal(a.state.pending.length,1);const restarted=new SyncEngine({account:'owner',remote,db});await restarted.start();assert.equal(restarted.state.snapshot.entries[0].note,'abc');await restarted.sync();assert.equal(remote.rows.get('vocabulary/s1:3:3').data.note,'abc');
});
test('saving from a slightly stale UI does not delete a newly received remote word',async()=>{
 const {a,b}=await devices(),oldUI=clone(b.state.snapshot);const other=clone(a.state.snapshot);other.entries.push({...word,id:'s2:1:1',text:'kaffe'});await a.save(other);await a.sync();await b.sync();
 const changed=clone(oldUI);changed.entries[0].note='typed while updates arrived';await b.save(changed,oldUI);await b.sync();assert.equal(b.state.snapshot.entries.length,2);assert.equal(b.state.snapshot.entries[0].note,'typed while updates arrived');
});
test('local database stores the snapshot and journal together and isolates accounts',async()=>{
 const database=new LocalDatabase(indexedDB);await database.save('first',{snapshot:{note:'private'},pending:[{opId:'retry'}]});assert.equal(await database.load('second'),undefined);database.close();
 const reopened=new LocalDatabase(indexedDB);assert.deepEqual(await reopened.load('first'),{snapshot:{note:'private'},pending:[{opId:'retry'}]});reopened.close();
});
test('failed local save rolls back the queue and reports failure',async()=>{
 const engine=new SyncEngine({account:'owner',remote:new Remote(),db:{load:async()=>undefined,save:async()=>{throw new Error('Disk full');}}});await engine.start();const next=emptySnapshot();next.entries=[word];await assert.rejects(()=>engine.save(next),/Disk full/);assert.equal(engine.state.pending.length,0);
});
test('full backup validates content, preserves notes, and remaps colliding article IDs',()=>{
 const current=emptySnapshot();current.library=[{id:'doc-one',title:'Cloud',text:'En svensk text.',sourceType:'paste'}];current.entries=[{...word,id:'doc-one:s1:0:0',sentenceId:'doc-one:s1',documentId:'doc-one'}];
 const incoming=clone(current);incoming.library[0].text='En annan svensk text.';incoming.entries[0].note='Imported memory';incoming.evaluation.preferred='a';
 const validated=validateBackup({format:'lasrum-backup',snapshot:incoming}),merged=mergeBackup(current,validated,()=> 'doc-two');
 assert.equal(merged.library.length,2);assert.equal(merged.entries[1].id,'doc-two:s1:0:0');assert.equal(merged.entries[1].documentId,'doc-two');assert.equal(merged.entries[1].note,'Imported memory');assert.equal(merged.evaluation.preferred,'a');
 assert.deepEqual(mergeBackup(merged,validated,()=> 'doc-two'),merged);
 assert.throws(()=>validateBackup({library:[{id:'bad',title:'bad',text:'fine',sourceUrl:'javascript:alert(1)'}],entries:[]}),/unsafe/);
});
