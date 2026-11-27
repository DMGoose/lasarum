import test from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import {AudioCache} from '../public/audio-cache.js';
const data={model:'heygen/heygen-voice-1-turbo',voice:'nadine',text:'stilla',context:'Det är en stilla morgon.'};
function audio(){const bytes=new Uint8Array(48),view=new DataView(bytes.buffer);for(const [at,text] of [[0,'RIFF'],[8,'WAVE'],[36,'data']])for(let i=0;i<text.length;i++)bytes[at+i]=text.charCodeAt(i);view.setUint32(4,40,true);view.setUint32(40,4,true);return new Response(bytes,{headers:{'Content-Type':'audio/wav'}});}

test('requested audio persists across reopening without another service request or prefetch',async t=>{
 const db=new IDBFactory();let calls=0;const first=new AudioCache({indexedDB:db}),fetchAudio=async()=>{calls++;return audio();};
 assert.equal(calls,0);const response=await first.response(data,{account:'owner',fetchAudio}),bytes=await response.arrayBuffer();assert.equal(calls,1);first.close();
 const reopened=new AudioCache({indexedDB:db});t.after(()=>reopened.close());
 const cached=await reopened.response(data,{account:'owner',fetchAudio:()=>{throw new Error('Network unavailable');}});
 assert.equal(cached.headers.get('x-device-audio-cache'),'hit');assert.deepEqual(await cached.arrayBuffer(),bytes);assert.equal(calls,1);
});

test('audio cache isolates accounts, Swedish context, model and voice',async t=>{
 const cache=new AudioCache({indexedDB:new IDBFactory()});t.after(()=>cache.close());let calls=0;const fetchAudio=async()=>{calls++;return audio();};
 for(const [input,account] of [[data,'owner'],[data,'other'],[{...data,voice:'gareth'},'owner'],[{...data,context:'Hon vill stilla sin hunger.'},'owner'],[{...data,model:'other-model'},'owner']])await cache.response(input,{account,fetchAudio});
 assert.equal(calls,5);await cache.response(data,{account:'owner',fetchAudio});assert.equal(calls,5);
});

test('failed, invalid and cancelled audio never populate the cache',async t=>{
 const cache=new AudioCache({indexedDB:new IDBFactory()});t.after(()=>cache.close());
 await assert.rejects(cache.response(data,{fetchAudio:async()=>new Response('error',{status:500})}));
 await assert.rejects(cache.response(data,{fetchAudio:async()=>new Response('not audio')}),/invalid audio/);
 const controller=new AbortController();await assert.rejects(cache.response(data,{signal:controller.signal,fetchAudio:async()=>{controller.abort();return audio();}}));
 assert.equal(await cache.read(await cache.key(data,'local-device')),undefined);
});

test('disk failure keeps playback working with a bounded session cache',async()=>{
 const cache=new AudioCache({indexedDB:null});let calls=0;const fetchAudio=async()=>{calls++;return audio();};
 await cache.response(data,{fetchAudio});await cache.response(data,{fetchAudio});assert.equal(calls,1);
});

test('device cache bounds retained bytes and never generates unrequested audio',async t=>{
 const cache=new AudioCache({indexedDB:new IDBFactory(),maxBytes:48});t.after(()=>cache.close());let calls=0;const fetchAudio=async()=>{calls++;return audio();};
 await cache.response(data,{fetchAudio});await cache.response({...data,text:'morgon'},{fetchAudio});
 assert.equal(calls,2);const db=await cache.open();const count=await new Promise(resolve=>{const request=db.transaction('audio').objectStore('audio').count();request.onsuccess=()=>resolve(request.result);});assert.equal(count,1);
});
