import https from 'node:https';
import {parseHTTPResponse} from './http-response.mjs';
import {setTimeout,clearTimeout} from 'node:timers';
import http from 'node:http';
import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
const fail=(status,message)=>Object.assign(new Error(message),{status});
export function isPublicAddress(address) {
 if(isIP(address)===4){
   const [a,b]=address.split('.').map(Number);
   return !(a===0||a===10||a===127||a>=224||(a===100&&b>=64&&b<=127)||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&(b===168||b===0))||(a===198&&(b===18||b===19)));
 }
 // Only global-unicast IPv6, excluding special/documentation and mapped ranges.
 return isIP(address)===6&&/^[23]/i.test(address)&&!/^200[12]:/i.test(address);
}
export function webURL(value) {
 let url;try{url=new URL(value);}catch{throw fail(400,'Enter a complete public webpage URL, such as https://example.com/article.');}
 if(!['https:','http:'].includes(url.protocol)||url.username||url.password||!['','80','443'].includes(url.port))throw fail(400,'Use a public HTTP or HTTPS webpage without sign-in details or a custom port.');
 url.hash='';return url;
}
function downloadNode(url,address) {
 return new Promise((resolve,reject)=>{
   const request=(url.protocol==='https:'?https:http).get(url,{
     headers:{'User-Agent':'Lasrum-Article-Importer/1.0','Accept':'text/html,text/plain;q=0.9','Accept-Encoding':'identity'},
     // Pin the validated DNS result, preventing a second DNS lookup/rebinding.
     lookup:(_host,options,callback)=>callback(null,options?.all?[{address,family:isIP(address)}]:address,isIP(address)),
     timeout:15000,agent:false
   },response=>{
     if(response.statusCode>=300&&response.statusCode<400){response.resume();resolve({status:response.statusCode,location:response.headers.location});return;}
     if(response.statusCode!==200){response.resume();reject(fail(502,'The webpage could not be imported. Paste its article text instead.'));return;}
     const type=response.headers['content-type']||'';
     if(!/^(text\/html|text\/plain|application\/xhtml\+xml)/i.test(type)){response.resume();reject(fail(400,'This link is not an HTML webpage or plain-text article.'));return;}
     if(response.headers['content-encoding']&&!/^identity$/i.test(response.headers['content-encoding'])){response.resume();reject(fail(502,'This webpage uses an unsupported encoding. Paste its article text instead.'));return;}
     let size=0;const chunks=[];
     response.on('data',chunk=>{size+=chunk.length;if(size>20*1024*1024){response.destroy(fail(413,'This webpage is too large. Paste just the article text instead.'));return;}chunks.push(chunk);});
     response.on('error',reject);
     response.on('end',()=>{
       try{const charset=/charset=["']?([^;\s"']+)/i.exec(type)?.[1]||'utf-8';resolve({status:200,type,body:new TextDecoder(charset).decode(Buffer.concat(chunks))});}
       catch{reject(fail(502,'Could not decode the webpage. Paste its article text instead.'));}
     });
   });
   request.on('timeout',()=>request.destroy(fail(504,'The webpage took too long to respond. Paste its article text instead.')));
   const deadline=setTimeout(()=>request.destroy(fail(504,'The webpage took too long to respond. Paste its article text instead.')),20000);
   deadline.unref();request.once('close',()=>clearTimeout(deadline));
   request.on('error',err=>reject(err.status?err:fail(502,'Could not reach this webpage. Paste its article text instead.')));
 });
}
// Edge's Node HTTP shim does not implement a custom DNS lookup callback.
// Connect to the validated IP, then verify TLS against the original hostname.
async function downloadEdge(url,address) {
 let connection,expired=false,deadline;
 const timeoutError=()=>fail(504,'The webpage took too long to respond. Paste its article text instead.');
 const close=()=>{try{connection?.close();}catch{/* Already closed. */}};
 const timeout=new Promise((_,reject)=>{deadline=setTimeout(()=>{expired=true;close();reject(timeoutError());},20000);});
 const operation=(async()=>{
   connection=await Deno.connect({hostname:address,port:url.protocol==='https:'?443:80});
   if(expired){close();throw timeoutError();}
   if(url.protocol==='https:')connection=await Deno.startTls(connection,{hostname:url.hostname.replace(/^\[|\]$/g,''),alpnProtocols:['http/1.1']});
   if(expired){close();throw timeoutError();}
   const request=new TextEncoder().encode(`GET ${url.pathname}${url.search} HTTP/1.1\r\nHost: ${url.host}\r\nUser-Agent: Lasrum-Article-Importer/1.0\r\nAccept: text/html,text/plain;q=0.9\r\nAccept-Encoding: identity\r\nConnection: close\r\n\r\n`);
   for(let sent=0;sent<request.length;){const written=await connection.write(request.subarray(sent));if(!written)throw fail(502,'The webpage connection closed.');sent+=written;}
   const parts=[];let size=0;
   while(true){const buffer=new Uint8Array(16384),count=await connection.read(buffer);if(count===null)break;if(!count)continue;size+=count;if(size>20*1024*1024+65536)throw fail(413,'This webpage is too large. Paste just the article text instead.');parts.push(buffer.subarray(0,count));}
   const bytes=new Uint8Array(size);let at=0;for(const part of parts){bytes.set(part,at);at+=part.length;}
   return parseHTTPResponse(bytes);
 })();
 try{return await Promise.race([operation,timeout]);}
 catch(error){throw error.status?error:fail(502,'Could not reach this webpage. Paste its article text instead.');}
 finally{clearTimeout(deadline);close();}
}
const download=typeof Deno==='undefined'?downloadNode:downloadEdge;
export async function fetchPublicArticle(value,{resolveDNS=lookup,downloadPage=download}={}) {
 let url=webURL(value);
 for(let redirects=0;redirects<=4;redirects++){
   const hostname=url.hostname.replace(/^\[|\]$/g,'');
   let records;try{records=isIP(hostname)?[{address:hostname}]:await resolveDNS(hostname,{all:true});}catch{throw fail(502,'Could not find this webpage. Check the link or paste the article text.');}
   if(!records.length||records.some(record=>!isPublicAddress(record.address)))throw fail(400,'Only public webpages can be imported. Local and private addresses are not supported.');
   const result=await downloadPage(url,records[0].address);
   if(result.status>=300&&result.status<400){if(!result.location)break;url=webURL(new URL(result.location,url).href);continue;}
   return {url:url.href,contentType:result.type,content:result.body};
 }
 throw fail(502,'This webpage redirected too many times. Paste its article text instead.');
}
