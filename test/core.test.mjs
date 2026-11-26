import test from 'node:test';
import assert from 'node:assert/strict';
import {tokenize,rangeSelection,addVisible,upsertEntry,removeLookup,createLookupTracker} from '../public/core.js';
import {sentences,fixture} from '../public/sample.js';

test('Swedish characters and punctuation retain their original offsets',()=>{
 const text='Åsa läser i Göteborg.';const tokens=tokenize(text);
 assert.equal(tokens.map(t=>t.text).join(''),text);
 for(const token of tokens)assert.equal(text.slice(token.offset,token.offset+token.text.length),token.text);
});
test('independent translations coexist; overlapping phrase replaces only inline labels',()=>{
 const one=rangeSelection(sentences,'s2',1,1),two=rangeSelection(sentences,'s2',2,2),other=rangeSelection(sentences,'s1',3,3);
 let visible=addVisible(addVisible(addVisible([],one),two),other);assert.equal(visible.length,3);
 const phrase=rangeSelection(sentences,'s2',2,1);assert.equal(phrase.text,'tycker om');
 visible=addVisible(visible,phrase);assert.equal(visible.length,2);assert.ok(visible.some(v=>v.id===other.id));
});
test('repeated encounters preserve notes without duplicate vocabulary entries',()=>{
 let entries=upsertEntry([],{id:'s1:0:0',translation:'first'});entries[0].note='My own note';
 entries=upsertEntry(entries,{id:'s1:0:0',translation:'new',note:'AI must not overwrite this'});
 assert.equal(entries.length,1);assert.equal(entries[0].note,'My own note');assert.equal(entries[0].translation,'new');
});
test('demo explicitly lacks unknown selections; phrase has contextual meaning',()=>{
 assert.equal(fixture('unknown'),null);assert.equal(fixture('tycker om').translation,'like');
 assert.equal(fixture('tycker om','zh').translation,'喜欢');
});
test('undo removes the exact phrase and its note, preserving other encounters',()=>{
 const phrase={id:'s2:1:2',text:'tycker om',note:'remove me'};
 const other={id:'s3:1:2',text:'tycker om',note:'keep me'};
 const result=removeLookup([phrase,other],[phrase,other],phrase.id);
 assert.deepEqual(result,{entries:[other],visible:[other]});
 assert.equal(upsertEntry(result.entries, {id:phrase.id,text:phrase.text}).at(-1).note,'');
});
test('undo and retry invalidate late replies without cancelling other words',async()=>{
 const tracker=createLookupTracker();
 const old=tracker.begin('word'),other=tracker.begin('other');
 let resolve;
 const late=new Promise(done=>{resolve=done;}).then(()=>tracker.isCurrent('word',old));
 tracker.cancel('word');
 const next=tracker.begin('word');resolve();
 assert.equal(await late,false);
 assert.equal(tracker.isCurrent('word',next),true);
 assert.equal(tracker.isCurrent('other',other),true);
 tracker.cancel('word');assert.equal(tracker.isCurrent('word',next),false);
});

test('word creation time survives refreshing its definition and sorting never mutates saved order',async()=>{
 const {sortVocabulary}=await import('../public/core.js');const old={id:'old',text:'gammal',createdAt:'2026-01-01T00:00:00Z'},fresh={id:'new',text:'ny',createdAt:'2026-02-01T00:00:00Z'};
 const entries=upsertEntry([old,fresh],{id:'old',translation:'updated',createdAt:'2026-12-01T00:00:00Z'});assert.equal(entries[0].createdAt,old.createdAt);assert.deepEqual(sortVocabulary(entries,true).map(x=>x.id),['new','old']);assert.deepEqual(sortVocabulary(entries,false).map(x=>x.id),['old','new']);assert.equal(entries[0].id,'old');assert.ok(upsertEntry([],{id:'third'})[0].createdAt);
 const legacy=[{id:'first'},{id:'second'}];assert.deepEqual(sortVocabulary(legacy,true).map(x=>x.id),['second','first']);
});
