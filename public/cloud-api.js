import {speechChunks} from './library.js';
let client=null,publishableKey='',cloudURL='';
export function configureCloudAPI(value,url,key){client=value;cloudURL=url;publishableKey=key;}
export async function cloudRequest(action,data,signal){
 if(!client)throw new Error('Sign in before using cloud features.');
 const {data:session}=await client.auth.getSession();if(!session.session)throw new Error('Sign in before using cloud features.');
 const response=await fetch(`${cloudURL}/functions/v1/${action}`,{method:data===undefined?'GET':'POST',headers:{apikey:publishableKey,Authorization:`Bearer ${session.session.access_token}`,...(data===undefined?{}:{'Content-Type':'application/json'})},...(data===undefined?{}:{body:JSON.stringify(data)}),signal});
 if(!response.ok){const result=await response.json().catch(()=>({}));throw new Error(result.error||'The cloud request failed.');}return response;
}
export async function speechResponse(data,signal,request=cloudRequest){
 const chunks=speechChunks(data.text),buffers=[];let total=0,cached=true,elapsed=0;
 for(let i=0;i<chunks.length;i++){
   if(signal?.aborted)throw signal.reason||new DOMException('Cancelled','AbortError');
   let response;try{response=await request('speech',{...data,text:chunks[i]},signal);}catch(error){if(signal?.aborted)throw error;throw new Error(`Audio part ${i+1}/${chunks.length} failed: ${error.message} Retry to reuse completed parts.`);}
   const bytes=new Uint8Array(await response.arrayBuffer());
   if(bytes.length<44||new TextDecoder().decode(bytes.slice(0,4))!=='RIFF'||new DataView(bytes.buffer,bytes.byteOffset).getUint32(24,true)!==24000||new DataView(bytes.buffer,bytes.byteOffset).getUint16(22,true)!==1)throw new Error('The cloud service returned invalid audio.');
   buffers.push(bytes.slice(44));total+=bytes.length-44;cached&&=response.headers.get('x-audio-cache')==='hit';elapsed+=Number(response.headers.get('x-elapsed-ms')||0);
   if(total>100*1024*1024)throw new Error('This article produces too much audio. Import a shorter section to listen.');
 }
 if(!buffers.length)throw new Error('There is no text to read.');
 const output=new Uint8Array(total+44),view=new DataView(output.buffer),write=(at,text)=>{for(let i=0;i<text.length;i++)output[at+i]=text.charCodeAt(i);};
 write(0,'RIFF');view.setUint32(4,total+36,true);write(8,'WAVE');write(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,24000,true);view.setUint32(28,48000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);write(36,'data');view.setUint32(40,total,true);
 let at=44;for(const bytes of buffers){output.set(bytes,at);at+=bytes.length;}
 return new Response(output,{headers:{'Content-Type':'audio/wav','X-Audio-Cache':cached?'hit':'miss','X-Elapsed-Ms':String(elapsed)}});
}
