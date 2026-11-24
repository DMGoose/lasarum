const fail=(status,message)=>Object.assign(new Error(message),{status});
const MAX=20*1024*1024;
const malformed=()=>fail(502,'The webpage returned an invalid response. Paste its article text instead.');
function lineEnd(bytes,start){for(let i=start;i<bytes.length-1;i++)if(bytes[i]===13&&bytes[i+1]===10)return i;return -1;}
export function parseHTTPResponse(bytes){
 let boundary=-1;for(let i=0;i<Math.min(bytes.length-3,65536);i++)if(bytes[i]===13&&bytes[i+1]===10&&bytes[i+2]===13&&bytes[i+3]===10){boundary=i;break;}
 if(boundary<0)throw malformed();
 const lines=new TextDecoder('iso-8859-1').decode(bytes.subarray(0,boundary)).split('\r\n'),status=/^HTTP\/1\.[01] (\d{3})(?: |$)/.exec(lines.shift());
 if(!status)throw malformed();
 const headers=new Headers();for(const line of lines){const colon=line.indexOf(':');if(colon<1||/^[ \t]/.test(line))throw malformed();try{headers.append(line.slice(0,colon),line.slice(colon+1).trim());}catch{throw malformed();}}
 const code=Number(status[1]);if(code>=300&&code<400)return {status:code,location:headers.get('location')};
 if(code!==200)throw fail(502,'The webpage could not be imported. Paste its article text instead.');
 const type=headers.get('content-type')||'';
 if(!/^(text\/html|text\/plain|application\/xhtml\+xml)/i.test(type))throw fail(400,'This link is not an HTML webpage or plain-text article.');
 if(headers.has('content-encoding')&&!/^identity$/i.test(headers.get('content-encoding')))throw fail(502,'This webpage uses an unsupported encoding. Paste its article text instead.');
 let body=bytes.subarray(boundary+4);const transfer=headers.get('transfer-encoding'),length=headers.get('content-length');
 if(transfer){
   if(transfer.toLowerCase()!=='chunked'||length!==null)throw malformed();
   const parts=[];let offset=0,total=0;
   while(true){const end=lineEnd(body,offset);if(end<0)throw malformed();const value=new TextDecoder().decode(body.subarray(offset,end)).split(';')[0];if(!/^[0-9a-f]+$/i.test(value))throw malformed();const size=Number.parseInt(value,16);offset=end+2;
     if(!Number.isSafeInteger(size)||total+size>MAX)throw fail(413,'This webpage is too large. Paste just the article text instead.');
     if(size===0){const trailers=body.subarray(offset);if(trailers.length<2||trailers.at(-2)!==13||trailers.at(-1)!==10)throw malformed();break;}
     if(offset+size+2>body.length||body[offset+size]!==13||body[offset+size+1]!==10)throw malformed();parts.push(body.subarray(offset,offset+size));total+=size;offset+=size+2;
   }
   body=new Uint8Array(total);let at=0;for(const part of parts){body.set(part,at);at+=part.length;}
 }else if(length!==null&&(!/^\d+$/.test(length)||Number(length)!==body.length))throw malformed();
 if(body.length>MAX)throw fail(413,'This webpage is too large. Paste just the article text instead.');
 try{return {status:200,type,body:new TextDecoder(/charset=["']?([^;\s"']+)/i.exec(type)?.[1]||'utf-8').decode(body)};}
 catch{throw fail(502,'Could not decode the webpage. Paste its article text instead.');}
}
