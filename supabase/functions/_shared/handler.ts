import {createClient} from 'npm:@supabase/supabase-js@2';
import {TEXT_MODEL,SPEECH_RATE,lookupPayload,validateLookup,speechPayload,pcmWav,openRouter,problem,string} from './ai.mjs';
import {fetchPublicArticle} from './import-url.mjs';
const env=(name:string)=>Deno.env.get(name)||'';
const apiKey=()=>{try{const keys=JSON.parse(env('SUPABASE_PUBLISHABLE_KEYS')||'{}');return Object.values(keys)[0] as string||env('SUPABASE_ANON_KEY');}catch{return env('SUPABASE_ANON_KEY');}};
const adminKey=()=>{try{const keys=JSON.parse(env('SUPABASE_SECRET_KEYS')||'{}');return Object.values(keys)[0] as string||env('SUPABASE_SERVICE_ROLE_KEY');}catch{return env('SUPABASE_SERVICE_ROLE_KEY');}};
async function body(request:Request){const reader=request.body?.getReader();if(!reader)return {};let size=0;const chunks:Uint8Array[]=[];while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>500000){await reader.cancel();throw problem(413,'Request too large.');}chunks.push(value);}const all=new Uint8Array(size);let at=0;for(const chunk of chunks){all.set(chunk,at);at+=chunk.length;}try{return JSON.parse(new TextDecoder().decode(all));}catch{throw problem(400,'Invalid JSON.');}}
async function verifiedUser(request:Request){
 const header=request.headers.get('Authorization')||'';if(!header.startsWith('Bearer '))throw problem(401,'Sign in to use this feature.');
 const client=createClient(env('SUPABASE_URL'),apiKey(),{global:{headers:{Authorization:header}},auth:{persistSession:false,autoRefreshToken:false}});
 const {data,error}=await client.auth.getUser(header.slice(7));if(error||!data.user)throw problem(401,'Your session expired. Sign in again.');
 const membership=await client.from('app_members').select('user_id').eq('user_id',data.user.id).maybeSingle();
 if(membership.error||!membership.data)throw problem(403,'This account is not approved for this private app.');
 return {client,user:data.user};
}
async function trimAudio(admin:ReturnType<typeof createClient>,owner:string,additional:number){
 const {data,error}=await admin.from('audio_cache').select('hash,path,bytes,expires_at,last_access').eq('owner_id',owner).order('last_access');if(error)throw error;
 const rows=data||[],remove=rows.filter(row=>Date.parse(row.expires_at)<=Date.now());let total=rows.reduce((n,row)=>n+Number(row.bytes),0)-remove.reduce((n,row)=>n+Number(row.bytes),0);
 for(const row of rows){if(total+additional<=200*1024*1024)break;if(!remove.includes(row)){remove.push(row);total-=Number(row.bytes);}}
 if(remove.length){const removed=await admin.storage.from('speech-cache').remove(remove.map(row=>row.path));if(removed.error)throw removed.error;const deleted=await admin.from('audio_cache').delete().eq('owner_id',owner).in('hash',remove.map(row=>row.hash));if(deleted.error)throw deleted.error;}
}
export function handler(action:string){return async(request:Request)=>{
 const origin=request.headers.get('Origin'),allowed=env('APP_ORIGINS').split(',').map(value=>value.trim()).filter(Boolean);
 const permitted=!origin||allowed.includes(origin),headers:Record<string,string>={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin'};
 if(origin&&permitted)Object.assign(headers,{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization,apikey,x-client-info,content-type','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Expose-Headers':'X-Audio-Cache,X-Elapsed-Ms'});
 const json=(status:number,data:unknown)=>new Response(JSON.stringify(data),{status,headers});
 if(!permitted)return json(403,{error:'This website origin is not allowed.'});
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
 try{
   if(!['POST','GET'].includes(request.method))throw problem(405,'Method not allowed.');
   const {user}=await verifiedUser(request);
   if(action==='app-config')return json(200,{configured:!!env('OPENROUTER_API_KEY'),textModel:TEXT_MODEL,cloud:true});
   if(action==='models'){const response=await openRouter('/audio/speech/models',null,{key:env('OPENROUTER_API_KEY')});return json(200,await response.json());}
   if(request.method!=='POST')throw problem(405,'Use POST for this operation.');
   const data=await body(request),start=performance.now();
   if(action==='import-url')return json(200,await fetchPublicArticle(string(data.url,'webpage URL',4000)));
   if(action==='lookup'){
     const response=await openRouter('/chat/completions',lookupPayload(data),{key:env('OPENROUTER_API_KEY')}),raw=await response.json();
     return json(200,{...validateLookup(raw.choices?.[0]?.message?.content||'',data.language),source:'live',model:TEXT_MODEL,elapsedMs:Math.round(performance.now()-start),cached:false});
   }
   if(action==='speech'){
     const payload=speechPayload(data),digest=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(payload)))),hash=Array.from(digest,b=>b.toString(16).padStart(2,'0')).join('');
     const admin=createClient(env('SUPABASE_URL'),adminKey(),{auth:{persistSession:false,autoRefreshToken:false}}),path=`${user.id}/${hash}.wav`;
     const cached=await admin.from('audio_cache').select('path,expires_at').eq('owner_id',user.id).eq('hash',hash).maybeSingle();
     let wav:Uint8Array|undefined,hit=false;
     if(cached.data&&Date.parse(cached.data.expires_at)>Date.now()){
       const download=await admin.storage.from('speech-cache').download(cached.data.path);
       if(download.data){wav=new Uint8Array(await download.data.arrayBuffer());hit=true;await admin.from('audio_cache').update({last_access:new Date().toISOString()}).eq('owner_id',user.id).eq('hash',hash);}
     }
     if(!wav){
       const response=await openRouter('/audio/speech',payload,{key:env('OPENROUTER_API_KEY')}),type=response.headers.get('content-type')||'';
       if(!/audio\/(pcm|l16)/i.test(type)){await response.body?.cancel();throw problem(502,'The provider returned an unexpected PCM audio format.');}
       const rate=/rate=(\d+)/i.exec(type);if(rate&&Number(rate[1])!==SPEECH_RATE)throw problem(502,'Unexpected audio sample rate.');
       const bytes=new Uint8Array(await response.arrayBuffer());if(bytes.length>25*1024*1024)throw problem(502,'The provider returned oversized audio.');wav=pcmWav(bytes);
       // Cache failure must not discard successfully generated audio.
       try{await trimAudio(admin,user.id,wav.length);const stored=await admin.storage.from('speech-cache').upload(path,wav,{contentType:'audio/wav',upsert:true});if(!stored.error)await admin.from('audio_cache').upsert({owner_id:user.id,hash,path,bytes:wav.length,last_access:new Date().toISOString(),expires_at:new Date(Date.now()+7*86400000).toISOString()});}catch{/* Return the audio and retry caching on a later request. */}
     }
     return new Response(wav,{headers:{...headers,'Content-Type':'audio/wav','X-Audio-Cache':hit?'hit':'miss','X-Elapsed-Ms':String(Math.round(performance.now()-start))}});
   }
   throw problem(404,'Unknown function.');
 }catch(error){const problem=error as Error&{status?:number};if(!problem.status)console.error('Cloud operation failed',{action,name:problem.name,message:problem.message});return json(problem.status||500,{error:problem.status?problem.message:'The cloud service could not complete this request. Please retry.'});}
};}
