import metadata from './dictionary-meta.json' with {type:'json'};
export {metadata as dictionaryMetadata};
export const dictionaryKey=value=>String(value).normalize('NFC').trim().replace(/\s+/gu,' ').toLocaleLowerCase('sv');
const CACHE_TTL=30*24*60*60*1000;
const fields=['translation','lemma','grammar','explanation','example','exampleTranslation','source','model','elapsedMs','dictionarySenses','dictionaryVersion'];
const resultFields=value=>Object.fromEntries(fields.filter(key=>value[key]!==undefined).map(key=>[key,structuredClone(value[key])]));
export class LocalDictionary{
 constructor({indexedDB=globalThis.indexedDB,fetcher=globalThis.fetch?.bind(globalThis),url=new URL('./dictionary-data.json',import.meta.url),meta=metadata}={}){Object.assign(this,{indexedDB,fetcher,url,meta});this.memoryCache=new Map();}
 async open(){
   if(this.db)return this.db;if(!this.indexedDB)throw new Error('IndexedDB unavailable');
   if(!this.opening)this.opening=new Promise((resolve,reject)=>{
     const request=this.indexedDB.open('lasrum.dictionary.v1',1);
     request.onupgradeneeded=()=>{request.result.createObjectStore('dataset');request.result.createObjectStore('cache',{keyPath:'key'}).createIndex('savedAt','savedAt');};
     request.onsuccess=()=>{this.db=request.result;resolve(this.db);};request.onerror=()=>reject(request.error);
   }).catch(error=>{this.opening=null;throw error;});
   return this.opening;
 }
 async read(store,key){const db=await this.open();return new Promise((resolve,reject)=>{const request=db.transaction(store).objectStore(store).get(key);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
 async write(store,value,key){const db=await this.open();return new Promise((resolve,reject)=>{const transaction=db.transaction(store,'readwrite'),target=transaction.objectStore(store);if(key===undefined)target.put(value);else target.put(value,key);transaction.oncomplete=resolve;transaction.onerror=()=>reject(transaction.error);transaction.onabort=()=>reject(transaction.error||new Error('Cache save failed'));});}
 async start(){
   if(this.dataset)return this.dataset;if(this.loading)return this.loading;
   this.loading=(async()=>{
     const cached=await this.read('dataset','current').catch(()=>null);
     if(cached?.version===this.meta.version){this.dataset=cached;return cached;}
     const response=await this.fetcher(this.url);if(!response.ok)throw new Error('The local dictionary could not be downloaded.');const dataset=await response.json();
     if(dataset.version!==this.meta.version||!Array.isArray(dataset.entries)||!dataset.index)throw new Error('The local dictionary version is invalid.');
     this.dataset=dataset;await this.write('dataset',dataset,'current').catch(()=>{});return dataset;
   })().catch(error=>{this.loading=null;throw error;});return this.loading;
 }
 async lookup(text){
   const started=performance.now(),dataset=await this.start(),key=dictionaryKey(text);
   const ids=Object.hasOwn(dataset.index,key)?dataset.index[key]:[];if(!Array.isArray(ids)||!ids.length)return null;
   const records=ids.map(id=>dataset.entries[id]).filter(Boolean).sort((a,b)=>Number(dictionaryKey(b[0])===key)-Number(dictionaryKey(a[0])===key)).slice(0,6);
   if(!records.length)return null;
   const translations=[...new Set(records.flatMap(record=>record[2]))],lemmas=[...new Set(records.map(record=>record[0]))],parts=[...new Set(records.map(record=>record[1]))],example=records.flatMap(record=>record[3]).find(Boolean);
   return {translation:translations.slice(0,6).join('; '),lemma:lemmas.join(', '),grammar:parts.join(', '),explanation:records.map(record=>`${record[0]} (${record[1]}): ${record[2].join('; ')}`).join('\n'),example:example?.[0]||'',exampleTranslation:example?.[1]||'',source:'dictionary',model:this.meta.name,dictionaryVersion:this.meta.version,dictionarySenses:records.map(record=>({lemma:record[0],part:record[1],meanings:record[2]})),elapsedMs:Math.round(performance.now()-started)};
 }
 cacheKey(selection,language,account){return JSON.stringify(['lookup-v1',account||'local-device',selection.text.normalize('NFC'),selection.context.normalize('NFC').trim().replace(/\s+/gu,' '),language]);}
 async cached(selection,language,account){
   const key=this.cacheKey(selection,language,account),item=this.memoryCache.get(key)||await this.read('cache',key).catch(()=>null);
   if(!item||Date.now()-item.savedAt>CACHE_TTL)return null;this.memoryCache.set(key,item);return {...structuredClone(item.result),cacheHit:true};
 }
 async remember(selection,result,{language='en',account='local-device'}={}){
   const key=this.cacheKey(selection,language,account),item={key,savedAt:Date.now(),result:resultFields(result)};
   this.memoryCache.set(key,item);if(this.memoryCache.size>2000)this.memoryCache.delete(this.memoryCache.keys().next().value);
   await this.write('cache',item).catch(()=>{});
   // Context caches contain private text, stay local, expire, and are size bounded.
   try{const db=await this.open();await new Promise((resolve,reject)=>{const transaction=db.transaction('cache','readwrite'),store=transaction.objectStore('cache'),count=store.count();count.onsuccess=()=>{let extra=count.result-2000;if(extra<=0)return;const cursor=store.index('savedAt').openCursor();cursor.onsuccess=()=>{if(cursor.result&&extra-->0){cursor.result.delete();cursor.result.continue();}};};transaction.oncomplete=resolve;transaction.onerror=()=>reject(transaction.error);});}catch{/* In-memory caching still works if disk storage is unavailable. */}
 }
 async resolve(selection,{language='en',account='local-device',force=false,existing=null,fetchAI}={}){
   if(!force){
     let word=null,dictionaryFailure;
     if(language==='en')try{word=await this.lookup(selection.text);}catch(error){dictionaryFailure=error;}
     if(word)return word;
     const cached=await this.cached(selection,language,account);if(cached)return cached;
     if(existing?.language===language&&existing.source==='live'&&existing.text===selection.text&&existing.context===selection.context)return {...resultFields(existing),cacheHit:true};
     if(dictionaryFailure)throw dictionaryFailure;
   }
   const result=await fetchAI();await this.remember(selection,result,{language,account});return result;
 }
 close(){this.db?.close();this.db=null;this.opening=null;}
}
