import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createApp,pcmToWav,validateExplanation} from '../server.mjs';

async function setup(t,options={}){
 const cacheDir=await mkdtemp(path.join(os.tmpdir(),'lasrum-test-'));
 const server=createApp({...options,cacheDir});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{await new Promise(resolve=>server.close(resolve));await rm(cacheDir,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${server.address().port}`;
 const config=await (await fetch(`${base}/api/config`)).json();
 return {base,config,post:(url,body)=>fetch(`${base}${url}`,{method:'POST',headers:{'Content-Type':'application/json','X-App-Token':config.token},body:JSON.stringify(body)})};
}
test('PCM is wrapped as 24 kHz, mono, signed 16-bit WAV without altering samples',()=>{
 const pcm=Buffer.from([0,0,255,127,0,128]);const wav=pcmToWav(pcm);
 assert.equal(wav.toString('ascii',0,4),'RIFF');assert.equal(wav.readUInt32LE(24),24000);assert.equal(wav.readUInt16LE(22),1);assert.deepEqual(wav.subarray(44),pcm);
 assert.throws(()=>pcmToWav(Buffer.from([0])));
});

test('web article import is local-token protected and returns preview without an AI key',async t=>{
 let imported='';const app=await setup(t,{apiKey:'',importPage:async url=>{imported=url;return {url,contentType:'text/html',content:'<article>En svensk text.</article>'};}});
 assert.equal((await fetch(`${app.base}/api/import-url`,{method:'POST',body:JSON.stringify({url:'https://example.com'})})).status,403);
 const result=await app.post('/api/import-url',{url:'https://example.com/article'});assert.equal(result.status,200);
 assert.equal(imported,'https://example.com/article');assert.match((await result.json()).content,/svensk text/);
 assert.equal((await app.post('/api/import-url',{url:''})).status,400);
});
test('long imported articles synthesize bounded chunks and combine into one seekable WAV',async t=>{
 const inputs=[];const app=await setup(t,{apiKey:'test-key',request:async(_url,options)=>{
   inputs.push(JSON.parse(options.body).input);return new Response(Buffer.alloc(4800),{headers:{'Content-Type':'audio/pcm;rate=44100'}});
 }});
 const text='Jag läser svenska. '.repeat(330),data={model:'heygen/heygen-voice-1-turbo',voice:'nadine',text};
 const response=await app.post('/api/speech',data);assert.equal(response.status,200);
 const wav=Buffer.from(await response.arrayBuffer());assert.ok(inputs.length>1);assert.ok(inputs.every(input=>input.length<=2800));
 assert.equal(inputs.join(' '),text.trim());assert.equal(wav.readUInt32LE(40),inputs.length*4800);
 const calls=inputs.length;assert.equal((await app.post('/api/speech',data)).headers.get('x-audio-cache'),'hit');assert.equal(inputs.length,calls);
});
test('missing credentials fail clearly and secrets are not served',async t=>{
 const app=await setup(t,{apiKey:''});assert.equal(app.config.configured,false);
 const res=await app.post('/api/speech',{model:'heygen/heygen-voice-1-turbo',voice:'nadine',text:'Hej.'});assert.equal(res.status,503);
 assert.equal((await fetch(`${app.base}/.env`)).status,404);
 assert.equal((await fetch(`${app.base}/api/lookup`,{method:'POST',body:'{}'})).status,403);
 assert.equal((await fetch(`${app.base}/api/config`,{headers:{Origin:'https://example.com'}})).status,403);
});
test('speech uses selected HeyGen model, returns WAV, and reuses cache by voice and content',async t=>{
 let calls=0;
 const app=await setup(t,{apiKey:'test-key',request:async(url,options)=>{
   calls++;assert.equal(url,'https://openrouter.ai/api/v1/audio/speech');const payload=JSON.parse(options.body);
   assert.equal(payload.model,'heygen/heygen-voice-1-turbo');assert.equal(payload.response_format,'pcm');assert.equal(payload.provider.options.heygen.language,'sv');
   assert.match(payload.instructions,/Språk: svenska \(sv-SE\)/);
   assert.match(payload.instructions,/enstaka ord och korta fraser/);
   assert.match(payload.instructions,/Använd aldrig engelskt uttal eller engelsk accent/);
   return new Response(Buffer.alloc(4800),{headers:{'Content-Type':'audio/pcm;rate=44100'}});
 }});
 const data={model:'heygen/heygen-voice-1-turbo',voice:'nadine',text:'Hej världen.'};
 const one=await app.post('/api/speech',data);assert.equal(one.status,200);assert.equal(one.headers.get('content-type'),'audio/wav');assert.equal(one.headers.get('x-audio-cache'),'miss');
 const wav=Buffer.from(await one.arrayBuffer());assert.equal(wav.byteLength,4844);assert.equal(wav.readUInt32LE(24),44100);
 const two=await app.post('/api/speech',data);assert.equal(two.headers.get('x-audio-cache'),'hit');assert.equal(calls,1);
 await app.post('/api/speech',{...data,voice:'gareth'});assert.equal(calls,2);
});
test('provider error bodies and invalid audio are not exposed as playable media',async t=>{
 const app=await setup(t,{apiKey:'test-key',request:async()=>new Response('{"error":"internal provider detail"}',{headers:{'Content-Type':'application/json'}})});
 const response=await app.post('/api/speech',{model:'heygen/heygen-voice-1-turbo',voice:'nadine',text:'Hej.'});
 assert.equal(response.status,502);assert.match((await response.json()).error,/unexpected PCM/);
});

test('isolated Swedish homographs use sentence context without reading the context aloud',async t=>{
 const payloads=[];
 const app=await setup(t,{apiKey:'test-key',request:async(_url,options)=>{
   payloads.push(JSON.parse(options.body));return new Response(Buffer.alloc(4800),{headers:{'Content-Type':'audio/pcm;rate=44100'}});
 }});
 const data={model:'heygen/heygen-voice-1-turbo',voice:'nadine',text:'glass',context:'Jag äter glass.'};
 assert.equal((await app.post('/api/speech',data)).status,200);
 assert.equal(payloads[0].input,'glass');
 assert.match(payloads[0].instructions,/Språk: svenska \(sv-SE\)/);
 assert.match(payloads[0].instructions,/Läs INTE upp kontextmeningen: "Jag äter glass\."/);
 await app.post('/api/speech',data);assert.equal(payloads.length,1);
 await app.post('/api/speech',{...data,context:'Hon köper glass.'});assert.equal(payloads.length,2);
 assert.equal((await app.post('/api/speech',{...data,context:42})).status,400);
});
test('lookup validates model output and keys cached meanings by sentence and language',async t=>{
 let calls=0;
 const app=await setup(t,{apiKey:'test-key',request:async()=>{calls++;return Response.json({choices:[{message:{content:JSON.stringify({translation:'like',lemma:'tycka om',grammar:'verb',explanation:'A phrase expressing preference.',example:'Jag tycker om kaffe.'})}}]});}});
 const data={text:'tycker om',context:'Jag tycker om att läsa.',language:'en'};
 assert.equal((await app.post('/api/lookup',data)).status,200);
 const repeated=await (await app.post('/api/lookup',data)).json();assert.equal(repeated.cached,true);assert.equal(calls,1);
 await app.post('/api/lookup',{...data,language:'zh'});assert.equal(calls,2);
 assert.equal((await app.post('/api/lookup',{...data,text:'absent'})).status,400);
});
test('malformed AI JSON yields a recoverable failure',async t=>{
 const app=await setup(t,{apiKey:'test-key',request:async()=>Response.json({choices:[{message:{content:'not JSON'}}]})});
 assert.equal((await app.post('/api/lookup',{text:'Jag',context:'Jag läser.',language:'en'})).status,502);
});
test('Chinese explanations reject untranslated required fields',()=>{
 assert.throws(()=>validateExplanation({translation:'like',lemma:'tycka om',grammar:'verb',explanation:'Expresses liking.',example:'Jag tycker om kaffe.'},'Chinese'),/Chinese explanation/);
 assert.equal(validateExplanation({translation:'喜欢',lemma:'tycka om',grammar:'动词短语',explanation:'表达喜好。',example:'Jag tycker om kaffe.'},'Chinese').translation,'喜欢');
});

test('local questions reach the text model and cache independently from ordinary explanations',async t=>{
 const prompts=[];const app=await setup(t,{apiKey:'test-key',request:async(_url,options)=>{prompts.push(JSON.parse(options.body));return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({translation:'quiet',lemma:'stilla',grammar:'adjective',explanation:'A contextual explanation.',example:'En stilla kväll.'})}}]}),{headers:{'Content-Type':'application/json'}});}});
 const data={text:'stilla',context:'En stilla morgon.',language:'en'};assert.equal((await app.post('/api/lookup',data)).status,200);assert.equal((await app.post('/api/lookup',{...data,question:'Explain this adjective.'})).status,200);assert.equal(prompts.length,2);assert.equal(JSON.parse(prompts[1].messages.find(message=>message.role==='user').content).learnerQuestion,'Explain this adjective.');await app.post('/api/lookup',{...data,question:'Explain this adjective.'});assert.equal(prompts.length,2);assert.equal((await app.post('/api/lookup',{...data,question:123})).status,400);
});
