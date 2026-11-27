import test from 'node:test';
import assert from 'node:assert/strict';
import {lookupPayload,speechPayload,speechInstructions,validateLookup,pcmWav,openRouter} from '../supabase/functions/_shared/ai.mjs';
import {speechResponse} from '../public/cloud-api.js';
test('cloud adapters preserve the chosen models and Swedish pronunciation instructions',()=>{
 const lookup=lookupPayload({text:'glass',context:'Jag äter glass.',language:'en'});assert.equal(lookup.model,'nvidia/nemotron-3.5-lightning:free');assert.match(lookup.messages[0].content,/English/);
 const speech=speechPayload({model:'heygen/heygen-voice-1-turbo',voice:'nadine',text:'glass',context:'Jag äter glass.'});assert.match(speech.instructions,/svenska \(sv-SE\)/);assert.match(speech.instructions,/Läs INTE upp kontextmeningen/);assert.equal(speech.input,'glass');
 assert.throws(()=>speechPayload({...speech,text:'a'.repeat(2801)}),/Invalid speech text/);assert.throws(()=>validateLookup('not json','en'),/valid JSON/);
});
test('reported Swedish pronunciations get targeted hints without altering the selected word',()=>{
 for(const text of ['stilla','taget']){const payload=speechPayload({model:'heygen/heygen-voice-1-turbo',voice:'nadine',text,context:`Ordet är ${text}.`});assert.equal(payload.input,text);assert.match(payload.instructions,new RegExp(`Uttalsstöd för ${text}`));assert.match(payload.instructions,/svenska \(sv-SE\)/);assert.doesNotMatch(payload.instructions,/Language:|NOT English/);}
 assert.doesNotMatch(speechInstructions('target'),/Uttalsstöd för taget/);
});
test('cloud chunk requests combine into a valid seekable WAV and reuse completed cached parts',async()=>{
 const inputs=[];const response=await speechResponse({text:'Jag läser svenska. '.repeat(330),model:'heygen/heygen-voice-1-turbo',voice:'nadine'},undefined,async(action,data)=>{assert.equal(action,'speech');inputs.push(data.text);return new Response(pcmWav(new Uint8Array(4800)),{headers:{'x-audio-cache':'hit','x-elapsed-ms':'12'}});});
 const bytes=new Uint8Array(await response.arrayBuffer());assert.ok(inputs.length>1);assert.ok(inputs.every(text=>text.length<=700));assert.equal(new DataView(bytes.buffer).getUint32(40,true),inputs.length*4800);assert.equal(response.headers.get('x-audio-cache'),'hit');
});
test('cloud upstream errors never expose provider bodies or credentials',async()=>{
 await assert.rejects(()=>openRouter('/audio/speech',{}, {key:'server-secret',fetcher:async()=>new Response('secret debug text',{status:402})}),error=>error.message==='OpenRouter credits are insufficient.');
});

test('HeyGen pins Swedish via provider options, rejects unselected models and old voices, and wraps 44.1 kHz PCM',()=>{
 const data={model:'heygen/heygen-voice-1-turbo',voice:'nadine',text:'stilla'};
 const payload=speechPayload(data);assert.equal(payload.provider.options.heygen.language,'sv');
 assert.match(payload.instructions,/Använd aldrig engelskt uttal/);assert.equal(payload.input,'stilla');
 assert.throws(()=>speechPayload({...data,model:'heygen/heygen-voice-1-turbo:free'}),/Use heygen/);
 assert.throws(()=>speechPayload({...data,voice:'Kore'}),/HeyGen voice/);
 const pcm=new Uint8Array([0,0,1,0]),wav=pcmWav(pcm),view=new DataView(wav.buffer);
 assert.equal(view.getUint32(24,true),44100);assert.equal(view.getUint32(28,true),88200);assert.deepEqual(wav.slice(44),pcm);
});

test('optional learner questions keep the original prompt and context and validate bounds',()=>{
 const data={text:'stilla',context:'Det är en stilla morgon.',language:'en'},plain=lookupPayload(data),asked=lookupPayload({...data,question:'  Why does it end in a?  '});
 assert.equal(asked.messages[0].content,plain.messages[0].content);const payload=JSON.parse(asked.messages.find(message=>message.role==='user').content);assert.equal(payload.selected,data.text);assert.equal(payload.sourceSentence,data.context);assert.equal(payload.learnerQuestion,'Why does it end in a?');assert.equal(JSON.parse(plain.messages.at(-1).content).learnerQuestion,undefined);assert.throws(()=>lookupPayload({...data,question:'a'.repeat(1001)}),/at most 1000/);
});
