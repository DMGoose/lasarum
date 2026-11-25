import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {IDBFactory} from 'fake-indexeddb';
import {LocalDictionary,dictionaryKey,dictionaryMetadata} from '../public/dictionary.js';
const dataset=JSON.parse(await readFile(new URL('../public/dictionary-data.json',import.meta.url),'utf8'));
const selection=(text,context=`Jag ser ${text}.`)=>({text,context});
const aiResult={translation:'a rare expression',lemma:'rare',grammar:'noun',explanation:'A contextual meaning.',example:'Ett exempel.',source:'live',model:'test'};
const dictionary=()=>new LocalDictionary({indexedDB:new IDBFactory(),fetcher:async()=>new Response(JSON.stringify(dataset))});

test('default downloader preserves the browser fetch receiver',async t=>{
 const original=globalThis.fetch;let d;
 try{
   globalThis.fetch=function(){assert.equal(this,globalThis);return Promise.resolve(new Response(JSON.stringify(dataset)));};
   d=new LocalDictionary({indexedDB:new IDBFactory()});
 }finally{globalThis.fetch=original;}
 t.after(()=>d.close());assert.equal((await d.lookup('morgon')).translation,'morning');
});
test('bundled Swedish-English dictionary resolves real inflections and preserves Swedish letters',async t=>{
 const d=dictionary();t.after(()=>d.close());
 assert.ok(dictionaryMetadata.formCount>60000);assert.ok(dictionaryMetadata.entryCount>30000);
 assert.equal(dictionaryKey('  A\u030ASA  '),'åsa');assert.notEqual(dictionaryKey('far'),dictionaryKey('får'));
 for(const [word,lemma,meaning] of [['MORGONEN','morgon','morning'],['läser','läsa','read'],['gick','gå','go'],['glass','glass','ice cream'],['stöter','stöta','knock']]){
   const result=await d.lookup(word);assert.equal(result.source,'dictionary');assert.ok(result.lemma.includes(lemma),word);assert.ok(result.translation.includes(meaning),word);
 }
 const stilla=await d.lookup('stilla');assert.match(stilla.grammar,/adjective/);assert.doesNotMatch(stilla.grammar,/supine|neuter/);assert.ok(stilla.example);assert.ok(stilla.exampleTranslation);
});
test('dictionary hits never invoke AI and the database reopens offline without a download',async t=>{
 const db=new IDBFactory();let downloads=0,calls=0;const online=new LocalDictionary({indexedDB:db,fetcher:async()=>{downloads++;return new Response(JSON.stringify(dataset));}});
 await online.resolve(selection('stilla'),{fetchAI:async()=>{calls++;return aiResult;}});online.close();
 const offline=new LocalDictionary({indexedDB:db,fetcher:async()=>{throw new Error('Offline');}});t.after(()=>offline.close());
 const result=await offline.resolve(selection('läser'),{fetchAI:async()=>{calls++;return aiResult;}});
 assert.equal(result.source,'dictionary');assert.equal(downloads,1);assert.equal(calls,0);
});
test('AI misses cache by account, language and source sentence, with explicit force refresh',async t=>{
 const d=dictionary();t.after(()=>d.close());let calls=0;const fetchAI=async()=>{calls++;return {...aiResult,note:'Private personal note must not enter lookup cache'};},unknown=selection('zqxsvenska');
 await d.resolve(unknown,{account:'owner',fetchAI});const cached=await d.resolve(unknown,{account:'owner',fetchAI});assert.equal(calls,1);assert.equal(cached.cacheHit,true);assert.equal(cached.note,undefined);
 await d.resolve(unknown,{account:'other',fetchAI});assert.equal(calls,2);
 await d.resolve(selection('zqxsvenska','En annan zqxsvenska.'),{account:'owner',fetchAI});assert.equal(calls,3);
 await d.resolve(unknown,{account:'owner',language:'zh',fetchAI});assert.equal(calls,4);
 await d.resolve(selection('stilla'),{force:true,account:'owner',fetchAI});assert.equal(calls,5);
});
test('expired or failed lookups are not reused and dictionary download errors do not silently call AI',async t=>{
 const d=dictionary();t.after(()=>d.close());const word=selection('zqxsvenska');await d.remember(word,aiResult);
 const key=d.cacheKey(word,'en','local-device'),old={key,savedAt:0,result:aiResult};d.memoryCache.set(key,old);await d.write('cache',old);
 assert.equal(await d.cached(word,'en','local-device'),null);
 const broken=new LocalDictionary({indexedDB:new IDBFactory(),fetcher:async()=>{throw new Error('Offline dictionary unavailable');}});t.after(()=>broken.close());let calls=0;
 await assert.rejects(()=>broken.resolve(selection('stilla'),{fetchAI:async()=>{calls++;return aiResult;}}),/unavailable/);assert.equal(calls,0);
 await assert.rejects(()=>d.resolve(word,{force:true,fetchAI:async()=>{throw new Error('Provider failed');}}),/Provider failed/);assert.equal(await d.cached(word,'en','local-device'),null);
});
