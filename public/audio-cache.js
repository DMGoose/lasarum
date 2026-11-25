// Only audio requested by the user is stored. Keep Swedish sentence context in
// the key: an isolated homograph can have a different pronunciation in context.
export class AudioCache{
 constructor({indexedDB=globalThis.indexedDB,maxBytes=200*1024*1024}={}){Object.assign(this,{indexedDB,maxBytes});this.memory=new Map();}
 async open(){
   if(this.db)return this.db;if(!this.indexedDB)throw new Error('IndexedDB unavailable');
   if(!this.opening)this.opening=new Promise((resolve,reject)=>{
     const request=this.indexedDB.open('lasrum.audio.v1',1);
     request.onupgradeneeded=()=>request.result.createObjectStore('audio',{keyPath:'key'}).createIndex('lastUsed','lastUsed');
     request.onsuccess=()=>{this.db=request.result;resolve(this.db);};request.onerror=()=>reject(request.error);
   }).catch(error=>{this.opening=null;throw error;});return this.opening;
 }
 async key(data,account){
   const normalized=value=>String(value||'').normalize('NFC').trim().replace(/\s+/gu,' ');
   const input=JSON.stringify(['swedish-sv-SE-context-v2',account,data.model,data.voice,normalized(data.text),normalized(data.context)]);
   const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(input));
   return Array.from(new Uint8Array(digest),value=>value.toString(16).padStart(2,'0')).join('');
 }
 async read(key){
   const memory=this.memory.get(key);if(memory)return memory;
   try{const db=await this.open();return await new Promise((resolve,reject)=>{const request=db.transaction('audio').objectStore('audio').get(key);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}catch{return null;}
 }
 async save(item){
   if(item.size>this.maxBytes)return;
   try{
     const db=await this.open();await new Promise((resolve,reject)=>{
       const transaction=db.transaction('audio','readwrite'),store=transaction.objectStore('audio');store.put(item);
       let total=0;const cursor=store.index('lastUsed').openCursor(null,'prev');
       cursor.onsuccess=()=>{if(!cursor.result)return;total+=cursor.result.value.size;if(total>this.maxBytes)cursor.result.delete();cursor.result.continue();};
       transaction.oncomplete=resolve;transaction.onerror=()=>reject(transaction.error);transaction.onabort=()=>reject(transaction.error||new Error('Audio cache save failed'));
     });
   }catch{
     // Private browsing / disk quota must not prevent playback. Retain a bounded
     // session cache if persistent storage is unavailable.
     this.memory.delete(item.key);this.memory.set(item.key,item);let total=0;
     for(const [key,value] of [...this.memory].reverse()){total+=value.size;if(total>this.maxBytes)this.memory.delete(key);}
   }
 }
 async response(data,{account='local-device',signal,fetchAudio}={}){
   const check=()=>{if(signal?.aborted)throw signal.reason||new DOMException('Cancelled','AbortError');};check();
   const key=await this.key(data,account),cached=await this.read(key);check();
   if(cached){await this.save({...cached,lastUsed:Date.now()});check();return new Response(cached.blob,{headers:{'Content-Type':'audio/wav','X-Audio-Cache':'hit','X-Device-Audio-Cache':'hit','X-Elapsed-Ms':'0'}});}
   const response=await fetchAudio();check();if(!response.ok)throw new Error('The speech service could not generate audio.');
   const blob=await response.blob();check();const header=new Uint8Array(await blob.slice(0,44).arrayBuffer()),decode=bytes=>new TextDecoder().decode(bytes);
   if(blob.size<=44||decode(header.slice(0,4))!=='RIFF'||decode(header.slice(8,12))!=='WAVE'||decode(header.slice(36,40))!=='data')throw new Error('The speech service returned invalid audio.');
   await this.save({key,blob,size:blob.size,lastUsed:Date.now()});check();
   const headers=new Headers(response.headers);headers.set('X-Device-Audio-Cache','miss');return new Response(blob,{headers});
 }
 close(){this.db?.close();this.db=null;this.opening=null;}
}
