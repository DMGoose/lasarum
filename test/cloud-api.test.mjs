import test from 'node:test';
import assert from 'node:assert/strict';
import {lookupPayload,speechPayload,validateLookup,pcmWav,openRouter} from '../supabase/functions/_shared/ai.mjs';
import {speechResponse} from '../public/cloud-api.js';
test('cloud adapters preserve the chosen models and Swedish pronunciation instructions',()=>{
 const lookup=lookupPayload({text:'glass',context:'Jag äter glass.',language:'en'});assert.equal(lookup.model,'nvidia/nemotron-3.5-lightning:free');assert.match(lookup.messages[0].content,/English/);
 const speech=speechPayload({model:'google/gemini-2.5-flash-tts',voice:'Kore',text:'glass',context:'Jag äter glass.'});assert.match(speech.instructions,/Swedish \(sv-SE\), NOT English/);assert.match(speech.instructions,/Läs INTE upp kontextmeningen/);assert.equal(speech.input,'glass');
 assert.throws(()=>speechPayload({...speech,text:'a'.repeat(2801)}),/Invalid speech text/);assert.throws(()=>validateLookup('not json','en'),/valid JSON/);
});
test('cloud chunk requests combine into a valid seekable WAV and reuse completed cached parts',async()=>{
 const inputs=[];const response=await speechResponse({text:'Jag läser svenska. '.repeat(330),model:'google/gemini-2.5-flash-tts',voice:'Kore'},undefined,async(action,data)=>{assert.equal(action,'speech');inputs.push(data.text);return new Response(pcmWav(new Uint8Array(4800)),{headers:{'x-audio-cache':'hit','x-elapsed-ms':'12'}});});
 const bytes=new Uint8Array(await response.arrayBuffer());assert.ok(inputs.length>1);assert.ok(inputs.every(text=>text.length<=2800));assert.equal(new DataView(bytes.buffer).getUint32(40,true),inputs.length*4800);assert.equal(response.headers.get('x-audio-cache'),'hit');
});
test('cloud upstream errors never expose provider bodies or credentials',async()=>{
 await assert.rejects(()=>openRouter('/audio/speech',{}, {key:'server-secret',fetcher:async()=>new Response('secret debug text',{status:402})}),error=>error.message==='OpenRouter credits are insufficient.');
});
