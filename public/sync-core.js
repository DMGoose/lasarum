import {cleanArticleText,articleSentences} from './library.js';
export const KINDS=['articles','vocabulary','reading_progress','user_settings'];
export const clone=value=>structuredClone(value);
export const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export const recordKey=(kind,id)=>`${kind}/${id}`;
export function emptySnapshot(){return {library:[],entries:[],evaluation:{results:[],preferred:'',notes:''},currentDocumentId:null,readingProgress:{}};}
export function snapshotRecords(snapshot){
 const rows=new Map();
 for(const item of snapshot.library||[])rows.set(recordKey('articles',item.id),{kind:'articles',id:item.id,data:{...clone(item),deletedAt:item.deletedAt||null}});
 for(const item of snapshot.entries||[])rows.set(recordKey('vocabulary',item.id),{kind:'vocabulary',id:item.id,data:{...clone(item),deletedAt:null}});
 for(const [id,value] of Object.entries(snapshot.readingProgress||{}))rows.set(recordKey('reading_progress',id),{kind:'reading_progress',id,data:clone(value)});
 const settings={...snapshot.evaluation};delete settings.results;
 for(const [id,value] of Object.entries(settings))rows.set(recordKey('user_settings',id),{kind:'user_settings',id,data:{value:clone(value)}});
 rows.set('user_settings/evaluationResults',{kind:'user_settings',id:'evaluationResults',data:{value:clone(snapshot.evaluation?.results||[])}});
 rows.set('user_settings/currentDocumentId',{kind:'user_settings',id:'currentDocumentId',data:{value:snapshot.currentDocumentId||null}});
 return rows;
}
export function recordsSnapshot(rows){
 const snapshot=emptySnapshot();
 for(const row of rows.values()){
   const data=clone(row.data);
   if(row.kind==='articles')snapshot.library.push(data);
   if(row.kind==='vocabulary'&&!data.deletedAt){delete data.deletedAt;snapshot.entries.push(data);}
   if(row.kind==='reading_progress'&&!data.deletedAt)snapshot.readingProgress[row.id]=data;
   if(row.kind==='user_settings'){
     if(row.id==='currentDocumentId')snapshot.currentDocumentId=data.value||null;
     else if(row.id==='evaluationResults')snapshot.evaluation.results=data.value||[];
     else snapshot.evaluation[row.id]=data.value;
   }
 }
 snapshot.library.sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')));
 if(!snapshot.library.some(item=>item.id===snapshot.currentDocumentId&&!item.deletedAt))snapshot.currentDocumentId=null;
 return snapshot;
}
export function patchBetween(before={},after={}){
 const patch={};for(const key of new Set([...Object.keys(before),...Object.keys(after)]))if(!equal(before[key],after[key]))patch[key]=after[key]===undefined?null:clone(after[key]);return patch;
}
export function diffSnapshots(before,after,knownRows,makeId=()=>crypto.randomUUID()){
 const previous=snapshotRecords(before),next=snapshotRecords(after),operations=[];
 for(const [key,row] of next){const base=previous.get(key)?.data||{},patch=patchBetween(base,row.data);if(Object.keys(patch).length)operations.push({opId:makeId(),kind:row.kind,id:row.id,baseVersion:knownRows.get(key)?.version||0,baseData:clone(base),patch});}
 for(const [key,row] of previous)if(row.kind==='vocabulary'&&!next.has(key))operations.push({opId:makeId(),kind:row.kind,id:row.id,baseVersion:knownRows.get(key)?.version||0,baseData:row.data,patch:{deletedAt:new Date().toISOString()}});
 return operations;
}
export function overlayRows(base,operations){
 const rows=new Map([...base].map(([key,row])=>[key,clone(row)]));
 for(const op of operations){const key=recordKey(op.kind,op.id),old=rows.get(key),data={...old?.data,...clone(op.patch)};if(old?.data.deletedAt&&!Object.hasOwn(op.patch,'deletedAt')&&!op.baseData?.deletedAt)data.deletedAt=null;rows.set(key,{kind:op.kind,id:op.id,version:old?.version||0,data});}
 return rows;
}
export function rebaseOperation(op,remote){
 const data=remote?.data||{};
 if(data.deletedAt&&!op.patch.deletedAt&&op.baseData?.deletedAt!==data.deletedAt)return {conflict:true};
 const conflict=Object.keys(op.patch).some(key=>!equal(data[key],op.baseData[key])&&!equal(data[key],op.patch[key]));
 return conflict?{conflict:true}:{operation:{...op,baseVersion:remote?.version||0,baseData:clone(data)}};
}
export function validateBackup(raw){
 const snapshot=raw?.format==='lasrum-backup'?raw.snapshot:raw;
 if(!snapshot||!Array.isArray(snapshot.library)||!Array.isArray(snapshot.entries))throw new Error('Choose a complete Läsrum backup, including articles and vocabulary.');
 if(snapshot.library.length>5000||snapshot.entries.length>100000)throw new Error('This backup is too large.');
 const ids=new Set();
 for(const article of snapshot.library){
   if(typeof article.id!=='string'||!article.id||article.id.length>250||ids.has(article.id))throw new Error('The backup has invalid or duplicate article IDs.');ids.add(article.id);
   if(typeof article.title!=='string'||article.title.length>200)throw new Error('The backup has an invalid article title.');
   cleanArticleText(article.text);articleSentences(article.text,article.id);
   if(article.sourceUrl){const url=new URL(article.sourceUrl);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new Error('The backup has an unsafe article URL.');}
 }
 const words=new Set();for(const entry of snapshot.entries){if(typeof entry.id!=='string'||entry.id.length>600||words.has(entry.id)||typeof entry.text!=='string'||typeof entry.context!=='string'||entry.text.length>250||entry.context.length>3000||typeof(entry.note??'')!=='string')throw new Error('The backup has an invalid vocabulary entry.');words.add(entry.id);}
 return {...emptySnapshot(),...clone(snapshot)};
}
export function mergeBackup(current,incoming,makeId=()=>`doc-${crypto.randomUUID()}`){
 const result=clone(current),mapping=new Map();
 for(const article of incoming.library){
   const same=result.library.find(item=>item.id===article.id);
   if(!same){result.library.push(clone(article));continue;}
   if(equal(same,article))continue;
   // Same source body is the same article. Never overwrite a newer cloud delete/title.
   if(same.text===article.text)continue;
   const priorImport=result.library.find(item=>item.text===article.text&&item.title===article.title&&item.sourceUrl===article.sourceUrl);
   if(priorImport){mapping.set(article.id,priorImport.id);continue;}
   const id=makeId();mapping.set(article.id,id);result.library.push({...clone(article),id});
 }
 for(const original of incoming.entries){
   const entry=clone(original);
   for(const [oldId,newId] of mapping){if(entry.documentId===oldId)entry.documentId=newId;if(entry.sentenceId?.startsWith(`${oldId}:`))entry.sentenceId=newId+entry.sentenceId.slice(oldId.length);if(entry.id.startsWith(`${oldId}:`))entry.id=newId+entry.id.slice(oldId.length);}
   const existing=result.entries.find(item=>item.id===entry.id);
   if(!existing)result.entries.push(entry);
   else if(entry.note&&existing.note!==entry.note){const block=`Imported note:\n${entry.note}`;if(!existing.note?.includes(block))existing.note=[existing.note,block].filter(Boolean).join('\n\n');}
 }
 result.readingProgress={...(incoming.readingProgress||{}),...(result.readingProgress||{})};
 for(const [oldId,newId] of mapping)if(incoming.readingProgress?.[oldId]){const value=clone(incoming.readingProgress[oldId]);if(value.sentenceId?.startsWith(`${oldId}:`))value.sentenceId=newId+value.sentenceId.slice(oldId.length);result.readingProgress[newId]=value;}
 for(const [key,value] of Object.entries(incoming.evaluation||{}))if(result.evaluation[key]===undefined||result.evaluation[key]===''||(Array.isArray(result.evaluation[key])&&!result.evaluation[key].length))result.evaluation[key]=clone(value);
 if(!result.currentDocumentId)result.currentDocumentId=mapping.get(incoming.currentDocumentId)||incoming.currentDocumentId||null;
 return result;
}
