import {sentences as sampleSentences, passages} from './sample.js';
import {cleanArticleText,articleSentences,extractWebArticle} from './library.js';
import {tokenize, rangeSelection, addVisible, upsertEntry, removeLookup, createLookupTracker} from './core.js';
import {CloudRuntime,cloudEnabled} from './cloud-runtime.js';
import {cloudRequest,speechResponse} from './cloud-api.js';
import {emptySnapshot,validateBackup,mergeBackup} from './sync-core.js';
import {importDocuments,splitChapters,paginateSentences,restoredPage,pageSpeechText,libraryGroups,MAX_TXT_BYTES} from './reading.js';
import {LocalDatabase} from './local-db.js';
import {LocalDictionary,dictionaryMetadata} from './dictionary.js';
import {AudioCache} from './audio-cache.js';
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const escape = text => String(text ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const STORAGE = 'lasrum.phase0.v1';
const dictionary=new LocalDictionary();
const audioCache=new AudioCache();
const dictionaryAccount=()=>cloudEnabled?(cloudRuntime?.user?.id||'signed-out'):'local-device';
function entrySource(entry){return entry.source==='dictionary'?'Local dictionary':entry.source==='demo'?'Demo fixture':entry.cacheHit?'Cached AI':'OpenRouter AI';}
let saved = {};
try { if(!cloudEnabled)saved = JSON.parse(localStorage.getItem(STORAGE) || '{}'); } catch { /* Recover with an empty prototype state. */ }
let entries = Array.isArray(saved.entries) ? saved.entries : [], evaluation = saved.evaluation || {results:[],preferred:'',notes:''};
let library=Array.isArray(saved.library)?saved.library:[],currentDocument=library.find(item=>item.id===saved.currentDocumentId&&!item.deletedAt)||null;
let readingProgress=saved.readingProgress||{};
let readerPages=paginateSentences(currentDocument?articleSentences(currentDocument.text,currentDocument.id):sampleSentences);
let currentPage=restoredPage(readerPages,readingProgress[currentDocument?.id||'sample']),sentences=readerPages[currentPage];
const deviceDB=cloudEnabled?null:new LocalDatabase();
let cloudRuntime=null,backupDraft=null,applyingRemote=false,pendingLocalSaves=0,deferredRemote=false,lastAppSnapshot=null;
$('#workspace').hidden=true;if(cloudEnabled)$('#auth-gate').hidden=false;
let visible = [], active = null, phrase = false, anchor = null, config = {}, requestId = 0, toastTimer;
let returnFocus = null;
let dragStart = null, suppressClick = false;
const lookupTracker = createLookupTracker(), pendingLookups = new Map();
const expandedWords = new Set(), vocabularyAI = new Map();
const speakerIcon='<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/></svg>';

const readerAudio = $('#reader-audio');
let speechGeneration=0, speechRequest=null, speechURL=null, speechOwner=null, speechState='idle', speechMessage='', readerSpeed=1;
function transportMarkup() {
 return `<div class="audio-transport" aria-label="Swedish audio player"><div class="transport-buttons"><button type="button" data-reader-skip="-5" aria-label="Back 5 seconds" disabled>↶ 5s</button><button type="button" data-reader-toggle disabled>▶ Play</button><button type="button" data-reader-skip="5" aria-label="Forward 5 seconds" disabled>5s ↷</button><label class="audio-speed">Speed<select data-reader-speed aria-label="Playback speed"><option value="0.75">0.75×</option><option value="1" selected>1×</option><option value="1.25">1.25×</option></select></label></div><label class="audio-timeline"><span class="sr-only">Playback position</span><input type="range" data-reader-seek aria-label="Playback position" min="0" max="0" step="0.01" value="0" disabled></label><div class="audio-timing"><span data-reader-time>0:00 / 0:00</span><button type="button" data-reader-restart disabled>↺ Restart</button></div></div>`;
}
function audioTime(seconds,precise=false) {const value=Math.max(0,seconds||0),whole=Math.floor(value);return `${Math.floor(whole/60)}:${String(whole%60).padStart(2,'0')}${precise?`.${Math.floor(value*10)%10}`:''}`;}
function updateTransport() {
 const duration=Number.isFinite(readerAudio.duration)?readerAudio.duration:0,time=readerAudio.currentTime||0,ready=!!speechURL&&duration>0;
 const precise=duration>0&&duration<10;
 $('#reader-transport').hidden=!ready||speechOwner!==pageAudioOwner();
 $$('[data-reader-seek]').forEach(slider=>{slider.disabled=!ready;slider.max=String(duration);slider.value=String(time);slider.setAttribute('aria-valuetext',`${audioTime(time,precise)} of ${audioTime(duration,precise)}`);});
 $$('[data-reader-time]').forEach(label=>label.textContent=`${audioTime(time,precise)} / ${audioTime(duration,precise)}`);
 $$('[data-reader-toggle]').forEach(button=>{button.disabled=!ready;button.textContent=readerAudio.paused?'▶ Play':'Ⅱ Pause';button.setAttribute('aria-label',readerAudio.paused?'Play audio':'Pause audio');});
 $$('[data-reader-skip],[data-reader-restart]').forEach(button=>button.disabled=!ready);
 $$('[data-reader-speed]').forEach(select=>select.value=String(readerSpeed));
}
function updateSpeechControls(message) {
 if(message!==undefined)speechMessage=message;
 for(const [selector,owner,label] of [['#read-aloud',pageAudioOwner(),'Read page'],['#play-word',active?.id,'Pronounce word']]){
   const button=$(selector);if(!button)continue;
   const selected=speechOwner===owner;
   if(selector==='#play-word'){
     button.innerHTML=speakerIcon;
     const action=selected&&speechState==='loading'?'Cancel pronunciation for':selected&&speechState==='playing'?'Pause pronunciation for':'Pronounce';
     button.setAttribute('aria-label',`${action} ${active?.text||'word'}`);button.title=`${action} ${active?.text||'word'}`;
   }else button.textContent=selected&&speechState==='loading'?'Cancel audio':selected&&speechState==='playing'?'Ⅱ Pause':selected&&speechState==='paused'?'▶ Resume':`▶ ${label}`;
   button.setAttribute('aria-pressed',String(selected&&['loading','playing'].includes(speechState)));
 }
 const audioError=/^(Audio unavailable:|Could not play audio|Playback was blocked)/.test(speechMessage)?speechMessage:'';
 $('#reader-audio-status').textContent=speechOwner===pageAudioOwner()?audioError:'';
 $$('[data-word-audio-status]').forEach(label=>label.textContent=speechOwner===active?.id?audioError:'');
 $$('[data-pronounce]').forEach(button=>{
   const entry=entries.find(item=>item.id===button.dataset.pronounce),selected=speechOwner===`vocab:${entry?.id}`;
   const loading=selected&&speechState==='loading',playing=selected&&speechState==='playing';
   button.innerHTML=loading?'…':playing?'Ⅱ':speakerIcon;
   button.setAttribute('aria-label',`${loading?'Cancel pronunciation for':playing?'Pause pronunciation for':'Pronounce'} ${entry?.text||''}`);
   button.setAttribute('aria-pressed',String(loading||playing));
 });
 $$('[data-vocab-audio-status]').forEach(label=>{const selected=speechOwner===`vocab:${label.dataset.vocabAudioStatus}`;label.hidden=!selected||!audioError;label.textContent=selected?audioError:'';});
 updateTransport();
}
function stopReaderSpeech() {
 ++speechGeneration;speechRequest?.abort();speechRequest=null;
 readerAudio.pause();readerAudio.removeAttribute('src');readerAudio.load();
 if(speechURL)URL.revokeObjectURL(speechURL);
 speechURL=null;speechOwner=null;speechState='idle';updateSpeechControls('');
}
async function speakInReader(text,owner,context) {
 if(speechOwner===owner&&speechState==='loading'){stopReaderSpeech();return;}
 if(speechOwner===owner&&!readerAudio.paused){readerAudio.pause();return;}
 if(speechOwner===owner&&speechURL){
   if(readerAudio.ended)readerAudio.currentTime=0;
   try{await readerAudio.play();}catch{updateSpeechControls('Playback was blocked. Tap Play to try again.');}
   return;
 }
 stopReaderSpeech();
 const generation=speechGeneration;speechOwner=owner;
 speechState='loading';updateSpeechControls('Preparing Swedish audio…');
 speechRequest=new AbortController();
 try{
   const voice=evaluation.preferredConfiguration?.voice||'Kore';
   const response=await api('/api/speech',{model:'google/gemini-2.5-flash-tts',voice,text,context},speechRequest.signal);
   const blob=await response.blob();if(generation!==speechGeneration)return;
   speechURL=URL.createObjectURL(blob);readerAudio.src=speechURL;readerAudio.playbackRate=owner===pageAudioOwner()?readerSpeed:1;speechState='ready';
   updateSpeechControls('Audio ready.');
   try{await readerAudio.play();}catch{if(generation===speechGeneration)updateSpeechControls('Audio ready. Tap Play to listen.');}
 }catch(err){if(generation===speechGeneration){speechState='idle';updateSpeechControls(`Audio unavailable: ${err.message}`);}}
 finally{if(generation===speechGeneration)speechRequest=null;}
}
readerAudio.onplay=()=>{speechState='playing';$$('#voice-candidates audio').forEach(audio=>audio.pause());updateSpeechControls('Playing in Swedish.');};
readerAudio.onended=()=>{speechState='ready';updateSpeechControls('');};
readerAudio.onpause=()=>{if(speechURL&&!readerAudio.ended){speechState='paused';updateSpeechControls('Paused.');}};
for(const event of ['loadedmetadata','durationchange','timeupdate','seeked','ratechange'])readerAudio.addEventListener(event,updateTransport);
readerAudio.onerror=()=>{if(speechURL){stopReaderSpeech();updateSpeechControls('Could not play audio. Tap Play to retry.');}};
$('#reader-transport').innerHTML=transportMarkup();
document.addEventListener('click',async event=>{
 const button=event.target.closest('[data-reader-toggle],[data-reader-skip],[data-reader-restart]');if(!button||!speechURL)return;
 if(button.hasAttribute('data-reader-toggle')){
   if(!readerAudio.paused)readerAudio.pause();
   else{if(readerAudio.ended)readerAudio.currentTime=0;try{await readerAudio.play();}catch{updateSpeechControls('Tap Play to try again.');}}
 }else{const duration=Number.isFinite(readerAudio.duration)?readerAudio.duration:0;readerAudio.currentTime=button.hasAttribute('data-reader-restart')?0:Math.max(0,Math.min(duration,readerAudio.currentTime+Number(button.dataset.readerSkip)));updateTransport();}
});
document.addEventListener('input',event=>{
 if(event.target.matches('[data-reader-seek]')&&speechURL){readerAudio.currentTime=Number(event.target.value);updateTransport();}
 if(event.target.matches('[data-reader-speed]')){readerSpeed=Number(event.target.value);readerAudio.playbackRate=readerSpeed;updateTransport();}
});
function pageAudioOwner(){return `page:${currentDocument?.id||'sample'}:${currentPage}`;}
$('#read-aloud').onclick=()=>speakInReader(pageSpeechText(sentences),pageAudioOwner());
async function undoLookup(selection) {
 const index=entries.findIndex(entry=>entry.id===selection.id),removed=index>=0?entries[index]:null,previousVisible=visible.filter(item=>item.id===selection.id);
 if(speechOwner===selection.id||speechOwner===`vocab:${selection.id}`)stopReaderSpeech();
 lookupTracker.cancel(selection.id);pendingLookups.delete(selection.id);vocabularyAI.delete(selection.id);
 ({entries,visible}=removeLookup(entries,visible,selection.id));
 if(!await persist()){
   if(removed&&!entries.some(entry=>entry.id===removed.id))entries.splice(Math.min(index,entries.length),0,removed);
   for(const item of previousVisible)if(sentences.some(sentence=>sentence.id===item.sentenceId)&&!visible.some(current=>current.id===item.id))visible.push(item);
   updateCount();renderReader();if(!$('#vocabulary-view').hidden)renderVocabulary();return false;
 }
 expandedWords.delete(selection.id);updateCount();renderReader();
 if(active?.id===selection.id){
   ++requestId;active=null;closeDetails();
   $('#lookup-origin').textContent='Word details';
   $('#detail-content').innerHTML='<div class="empty-detail">Select a word to translate.</div>';
 }
 if(!$('#vocabulary-view').hidden)renderVocabulary();return true;
}
function openDetails() {
 $('.detail-panel').classList.add('is-open');
 $('#open-details').setAttribute('aria-expanded','true');
 if (matchMedia('(max-width:730px)').matches && active) {
   const selected = `.word[data-sentence="${active.sentenceId}"][data-index="${active.start}"]`;
   requestAnimationFrame(()=>{
     const word=document.querySelector(selected),panel=$('.detail-panel');
     if(!word || !panel.classList.contains('is-open'))return;
     const overlap=word.getBoundingClientRect().bottom-panel.getBoundingClientRect().top+24;
     if(overlap>0)window.scrollBy({top:overlap,behavior:'instant'});
   });
 }
}
function closeDetails() {
 $('.detail-panel').classList.remove('is-open');
 $('#open-details').setAttribute('aria-expanded','false');
 if (returnFocus) document.querySelector(returnFocus)?.focus({preventScroll:true});
}
$('#open-details').onclick=openDetails;
$('#close-details').onclick=closeDetails;
document.addEventListener('keydown',event=>{if(event.key==='Escape')closeDetails();});
const candidates = [
 {id:'a',name:'Kore',voice:'Kore',model:'google/gemini-2.5-flash-tts',description:'Gemini 2.5 Flash TTS · Voice A'},
 {id:'b',name:'Puck',voice:'Puck',model:'google/gemini-2.5-flash-tts',description:'Gemini 2.5 Flash TTS · Voice B'}
];
const audioURLs = new Map();
function toast(message) {$('#toast').textContent=message;$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').hidden=true,4500);}
function snapshot(){return structuredClone({entries,evaluation,library,currentDocumentId:currentDocument?.id||null,readingProgress});}
async function persist() {
 const next=snapshot(),before=lastAppSnapshot;lastAppSnapshot=next;++pendingLocalSaves;
 try {if(cloudEnabled)await cloudRuntime.save(next,before);else await deviceDB.save('local-device',{snapshot:next});return true;}
 catch {if(lastAppSnapshot===next)lastAppSnapshot=before;toast('Could not save locally. Export your work before closing this page.');return false;}
 finally{--pendingLocalSaves;if(!pendingLocalSaves&&deferredRemote&&cloudRuntime?.engine){deferredRemote=false;applyCloudSnapshot(cloudRuntime.engine.state.snapshot);}}
}
function updateCount() {$('#word-count').textContent=entries.length;}
let importedURL=null,libraryDraftVersion=0;
function articleMetadata() {
 $('.book h2').textContent=currentDocument?.title||'En sida i taget';
 $('.book .subtitle').textContent=currentDocument?.bookTitle||(currentDocument?'':'One page at a time');$('.book .subtitle').hidden=!!currentDocument&&!currentDocument.bookTitle;
 $('.book .article-meta span').textContent=currentDocument?({txt:'TXT ARTICLE',url:'WEB ARTICLE',paste:'PASTED ARTICLE'}[currentDocument.sourceType]||'YOUR ARTICLE'):'ORIGINAL READING SAMPLE';
 $('.book .article-meta span:last-child').textContent=currentDocument?`${sentences.reduce((n,s)=>n+tokenize(s.text).filter(t=>t.word).length,0)} WORDS`:'A2–B1 · SHORT READ';
 $('.book-footer span').textContent=currentDocument?(currentDocument.sourceUrl?new URL(currentDocument.sourceUrl).hostname:'Saved in your Library'):'Göteborg, en stilla morgon';
 $('.book').setAttribute('aria-label',currentDocument?.title||'Swedish reading sample');
 $('#reader-source').hidden=!currentDocument?.sourceUrl;
 if(currentDocument?.sourceUrl){$('#reader-source').href=currentDocument.sourceUrl;$('#reader-source').textContent='Open original webpage ↗';}
 $('#back-library').hidden=!currentDocument;updateReadingNavigation();
}
function setReaderArticle(document,{pageIndex}={}) {
 clearTimeout(progressTimer);stopReaderSpeech();++requestId;
 for(const id of pendingLookups.keys())lookupTracker.cancel(id);pendingLookups.clear();
 currentDocument=document;readerPages=paginateSentences(document?articleSentences(document.text,document.id):sampleSentences);
 currentPage=pageIndex===undefined?restoredPage(readerPages,readingProgress[document?.id||'sample']):Math.max(0,Math.min(readerPages.length-1,pageIndex));sentences=readerPages[currentPage];
 visible=[];active=null;anchor=null;returnFocus=null;
 $('#lookup-origin').textContent='Word details';$('#detail-content').innerHTML='<div class="empty-detail"><p>Select a word to translate.</p></div>';
 articleMetadata();setMode(false);
}
function bookChapters(){return currentDocument?.bookId?library.filter(item=>item.bookId===currentDocument.bookId&&!item.deletedAt).sort((a,b)=>a.chapterIndex-b.chapterIndex):[];}
function updateReadingNavigation(){
 const chapters=bookChapters(),index=chapters.findIndex(item=>item.id===currentDocument?.id),hasPrevious=currentPage>0||index>0,hasNext=currentPage<readerPages.length-1||(index>=0&&index<chapters.length-1);
 $('[data-chapter-control]').hidden=chapters.length<2;
 $('#chapter-select').innerHTML=chapters.map((chapter,i)=>`<option value="${escape(chapter.id)}" ${chapter.id===currentDocument?.id?'selected':''}>${i+1}. ${escape(chapter.title)}</option>`).join('');
 $$('[data-page-navigation]').forEach(nav=>nav.hidden=readerPages.length<2&&chapters.length<2);
 $$('[data-page-label]').forEach(label=>label.textContent=`Page ${currentPage+1} / ${readerPages.length}`);
 $$('[data-page-step]').forEach(button=>button.disabled=Number(button.dataset.pageStep)<0?!hasPrevious:!hasNext);
}
async function openArticle(document,options={}) {
 setReaderArticle(document,options);
 const key=document?.id||'sample',prior=readingProgress[key]||{};
 readingProgress[key]={pageIndex:currentPage,sentenceId:options.pageIndex===undefined&&sentences.some(sentence=>sentence.id===prior.sentenceId)?prior.sentenceId:sentences[0]?.id};
 if(document?.bookId)readingProgress[`book:${document.bookId}`]={documentId:document.id};
 await persist();showView('reader');window.scrollTo({top:0,behavior:'instant'});
 const progress=readingProgress[key];if(progress?.sentenceId)requestAnimationFrame(()=>[...window.document.querySelectorAll('.sentence')].find(el=>el.dataset.sentence===progress.sentenceId)?.scrollIntoView({block:'nearest'}));
}
let turningPage=false;
document.addEventListener('click',async event=>{
 const button=event.target.closest('[data-page-step]');if(!button||button.disabled||turningPage)return;
 turningPage=true;try{
   const step=Number(button.dataset.pageStep),target=currentPage+step;
   if(target>=0&&target<readerPages.length)await openArticle(currentDocument,{pageIndex:target});
   else{const chapters=bookChapters(),index=chapters.findIndex(item=>item.id===currentDocument?.id),next=chapters[index+step];if(next)await openArticle(next,{pageIndex:step>0?0:Number.MAX_SAFE_INTEGER});}
 }finally{turningPage=false;}
});
$('#chapter-select').onchange=()=>{const chapter=library.find(item=>item.id===$('#chapter-select').value&&!item.deletedAt);if(chapter)void openArticle(chapter);};
let showDeletedArticles=false;
function renderLibrary() {
 const query=$('#library-search').value.trim().toLowerCase();
 const documents=libraryGroups(library,showDeletedArticles,query);
 const count=libraryGroups(library).length,deleted=libraryGroups(library,true).length;
 $('#library-count').textContent=`${count} saved ${count===1?'article':'articles'}`;
 $('#show-deleted').textContent=showDeletedArticles?'← Back to articles':`Recently deleted (${deleted})`;$('#show-deleted').setAttribute('aria-pressed',String(showDeletedArticles));
 $('#library-list').innerHTML=documents.length?documents.map(item=>`<article class="library-card"><div class="library-card-header"><span class="pill">${item.sourceType==='txt'?'TXT':item.sourceType==='url'?'Webpage':'Pasted text'}${item.chapters.length>1?` · ${item.chapters.length} chapters`:''}</span>${item.deletedAt?'':`<button type="button" class="delete-article" data-delete-document="${escape(item.id)}" aria-label="Delete ${escape(item.title)}" title="Delete article"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/></svg></button>`}</div><h3>${escape(item.title)}</h3><p class="library-excerpt">${escape(item.text.slice(0,180))}${item.text.length>180?'…':''}</p><p class="source-note">${escape(item.sourceUrl?new URL(item.sourceUrl).hostname:'Your own text')} · ${new Date(item.createdAt).toLocaleDateString()}</p>${item.deletedAt?`<button type="button" data-restore-document="${escape(item.id)}">Restore article</button>`:`<button type="button" data-read-document="${escape(item.id)}">Open in Read →</button>`}</article>`).join(''):`<div class="empty-state">${query?'No matching articles.':showDeletedArticles?'No recently deleted articles.':'No articles yet.'}</div>`;
}
$('#show-deleted').onclick=()=>{showDeletedArticles=!showDeletedArticles;renderLibrary();};
$('#library-list').addEventListener('click',async event=>{
 const button=event.target.closest('[data-read-document],[data-delete-document],[data-restore-document]');if(!button)return;
 const id=button.dataset.readDocument||button.dataset.deleteDocument||button.dataset.restoreDocument,article=library.find(item=>item.id===id);if(!article)return;
 if(button.hasAttribute('data-read-document')){if(!article.deletedAt){const resumed=article.bookId&&library.find(item=>item.id===readingProgress[`book:${article.bookId}`]?.documentId&&item.bookId===article.bookId&&!item.deletedAt);void openArticle(resumed||article);}return;}
 const targets=library.filter(item=>article.bookId?item.bookId===article.bookId:item.id===id),previous=targets.map(item=>({item,deletedAt:item.deletedAt})),oldDocument=currentDocument,wasCurrent=targets.some(item=>item.id===currentDocument?.id);
 if(button.hasAttribute('data-delete-document')){for(const item of targets)if(!item.deletedAt)item.deletedAt=new Date().toISOString();if(wasCurrent)setReaderArticle(null);}
 else for(const item of targets)delete item.deletedAt;
 if(!await persist()){for(const {item,deletedAt} of previous){if(deletedAt)item.deletedAt=deletedAt;else delete item.deletedAt;}if(wasCurrent)setReaderArticle(oldDocument);return;}
 renderLibrary();
});
let librarySearchTimer;$('#library-search').oninput=()=>{clearTimeout(librarySearchTimer);librarySearchTimer=setTimeout(renderLibrary,200);};
$('#open-sample').onclick=()=>openArticle(null);$('#back-library').onclick=()=>showView('library');
function importStatus(message,error=false){const status=$('#import-status');status.textContent=message;status.classList.toggle('error',error);}
$('#import-method').onchange=()=>{
 ++libraryDraftVersion;importedURL=null;const method=$('#import-method').value;
 $('#txt-upload-label').hidden=method!=='txt';$('#url-import-fields').hidden=method!=='url';
 $('#import-body-label').hidden=method==='url'&&!$('#import-body').value;
 $('#import-body').required=method!=='url';importStatus('');
};
$('#article-url').oninput=()=>{++libraryDraftVersion;importedURL=null;};
$('#txt-upload').onchange=async event=>{
 const file=event.target.files[0];if(!file)return;const version=++libraryDraftVersion;
 try{
   if(!/\.txt$/i.test(file.name))throw new Error('Choose a .txt plain-text file.');
   if(file.size>MAX_TXT_BYTES)throw new Error('Choose a TXT file smaller than 20 MB.');
   const bytes=await file.arrayBuffer();if(version!==libraryDraftVersion)return;
   let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw new Error('Save this TXT file with UTF-8 encoding, then upload it again.');}
   text=cleanArticleText(text);const preview=splitChapters(text);for(const chapter of preview)articleSentences(chapter.text,'preview');
   $('#import-body').value=text;$('#import-title').value=file.name.replace(/\.txt$/i,'');importedURL=null;
   importStatus(`TXT loaded · ${preview.length} ${preview.length===1?'chapter':'chapters'}. Save to import.`);
 }catch(err){importStatus(err.message,true);}
};
$('#fetch-article').onclick=async()=>{
 const version=++libraryDraftVersion,button=$('#fetch-article');button.disabled=true;importedURL=null;importStatus('Fetching article text…');
 try{
   const result=await(await api('/api/import-url',{url:$('#article-url').value.trim()})).json();
   if(version!==libraryDraftVersion)return;
   const article=/^text\/plain/i.test(result.contentType)?{title:new URL(result.url).hostname,text:cleanArticleText(result.content)}:extractWebArticle(result.content,result.url);
   for(const chapter of splitChapters(article.text))articleSentences(chapter.text,'preview');$('#import-body').value=article.text;$('#import-title').value=article.title;
   $('#import-body-label').hidden=false;importedURL=result.url;importStatus('Article fetched. Review the extracted text below before saving.');
 }catch(err){if(version===libraryDraftVersion)importStatus(err.message,true);}
 finally{button.disabled=false;}
};
$('#import-form').onsubmit=async event=>{
 event.preventDefault();const button=$('#import-form button[type=submit]');if(button.disabled)return;button.disabled=true;
 try{
   const sourceType=$('#import-method').value;
   if(sourceType==='url'&&!importedURL)throw new Error('Fetch the webpage first, then check its article text.');
   const text=cleanArticleText($('#import-body').value),title=($('#import-title').value.trim()||text.split('\n')[0].slice(0,80)).slice(0,200);
   importStatus('Splitting and saving chapters…');await new Promise(resolve=>setTimeout(resolve,0));
   const documents=importDocuments(text,{title,sourceType,sourceUrl:sourceType==='url'?importedURL:null}),previous=library;
   library=[...documents,...library];if(!await persist()){library=previous;throw new Error('Could not save the chapters. Export a backup and check browser storage.');}
   $('#import-form').reset();$('.import-tools').open=false;importedURL=null;++libraryDraftVersion;$('#import-method').onchange();$('#import-body').value='';importStatus('');
   await openArticle(documents[0],{pageIndex:0});
 }catch(err){importStatus(err.message,true);}finally{button.disabled=false;}
};
function showView(view) {
 stopReaderSpeech();
 closeDetails();
 $$('.view').forEach(el=>el.hidden=el.id!==`${view}-view`);
 $$('.nav').forEach(el=>{el.classList.toggle('active',el.dataset.view===view);if(el.dataset.view===view)el.setAttribute('aria-current','page');else el.removeAttribute('aria-current');});
 if(view==='vocabulary')renderVocabulary();
 if(view==='library')renderLibrary();
}
$$('.nav').forEach(button=>button.addEventListener('click',()=>showView(button.dataset.view)));
function renderReader() {
 const focused=document.activeElement?.closest('.word');
 const focusTarget=focused?`.word[data-sentence="${focused.dataset.sentence}"][data-index="${focused.dataset.index}"]`:null;
 let html = '', paragraph = -1;
 for(const sentence of sentences){
   if(sentence.paragraph!==paragraph){if(paragraph!==-1)html+='</p>';html+='<p>';paragraph=sentence.paragraph;}
   let wordIndex=0;
   html+=`<span class="sentence" data-sentence="${sentence.id}">`;
   for(const part of tokenize(sentence.text)){
     if(!part.word){html+=escape(part.text);continue;}
     const index=wordIndex++;
     const selection=visible.find(item=>item.sentenceId===sentence.id&&index>=item.start&&index<=item.end);
     const isAnchor=anchor?.sentenceId===sentence.id&&anchor.index===index;
     const label=selection?.start===index?`<span class="inline-translation" aria-hidden="true">${escape(selection.translation)}</span>`:'';
     html+=`<span role="button" tabindex="0" class="word${selection?' marked':''}${isAnchor?' anchor':''}" data-sentence="${sentence.id}" data-index="${index}" aria-label="${selection?'Undo lookup for':'Translate'} ${escape(part.text)}${selection?`: ${escape(selection.translation)}`:''}">${label}<span class="word-text">${escape(part.text)}</span></span>`;
   }
   html+='</span> ';
 }
 $('#reading-text').innerHTML=html+'</p>';
 if(focusTarget)document.querySelector(focusTarget)?.focus({preventScroll:true});
}
function setMode(value){phrase=value;anchor=null;$('#word-mode').classList.toggle('selected',!value);$('#phrase-mode').classList.toggle('selected',value);$('#word-mode').setAttribute('aria-pressed',String(!value));$('#phrase-mode').setAttribute('aria-pressed',String(value));$('#selection-hint').textContent=value?'Choose the first and last word in one sentence. You can also drag to select a phrase.':'Tap to translate and hear a word. Tap again to undo.';renderReader();}
$('#word-mode').onclick=()=>setMode(false);$('#phrase-mode').onclick=()=>setMode(true);
$('#clear').onclick=()=>{visible=[];anchor=null;renderReader();toast('Translations cleared. Your saved words are still available.');};
$('#font-size').onclick=()=>$('#reading-text').classList.toggle('large');
function handleWord(word){
 const sentenceId=word.dataset.sentence,index=Number(word.dataset.index);
 returnFocus=`.word[data-sentence="${sentenceId}"][data-index="${index}"]`;
 const selected=[...pendingLookups.values(),...visible].find(item=>item.sentenceId===sentenceId&&index>=item.start&&index<=item.end);
 if(selected&&!anchor){undoLookup(selected);return;}
 if(phrase&&!anchor){anchor={sentenceId,index};renderReader();$('#selection-hint').textContent='Now choose the last word in the same sentence.';return;}
 if(phrase&&anchor){
   if(anchor.sentenceId!==sentenceId){toast('Choose words within one sentence.');return;}
   const selected=rangeSelection(sentences,sentenceId,anchor.index,index);anchor=null;$('#selection-hint').textContent='Phrase selected. Choose another first and last word, or switch back to Words.';lookup(selected);return;
 }
 lookup(rangeSelection(sentences,sentenceId,index,index));
}
$('#reading-text').addEventListener('click',event=>{
 if(suppressClick){suppressClick=false;return;}
 if(window.getSelection()?.toString().trim())return;
 const word=event.target.closest('.word');if(word)handleWord(word);
});
$('#reading-text').addEventListener('keydown',event=>{if(['Enter',' '].includes(event.key)&&event.target.matches('.word')){event.preventDefault();handleWord(event.target);}});
$('#reading-text').addEventListener('pointerdown',event=>{
 const word=event.target.closest('.word');
 dragStart=word&&event.button===0&&event.pointerType!=='touch'?{sentenceId:word.dataset.sentence,index:Number(word.dataset.index),x:event.clientX,y:event.clientY}:null;
});
$('#reading-text').addEventListener('pointercancel',()=>{dragStart=null;});
$('#reading-text').addEventListener('pointerup',event=>{
 const start=dragStart;dragStart=null;
 const end=event.target.closest('.word');
 if(start&&end&&Math.hypot(event.clientX-start.x,event.clientY-start.y)>6&&Number(end.dataset.index)!==start.index){
   suppressClick=true;setTimeout(()=>{suppressClick=false;},0);
   if(start.sentenceId!==end.dataset.sentence){toast('Please select a phrase within one sentence.');return;}
   const selected=rangeSelection(sentences,start.sentenceId,start.index,Number(end.dataset.index));
   setTimeout(()=>{window.getSelection()?.removeAllRanges();anchor=null;lookup(selected);},0);return;
 }
 const selection=window.getSelection();if(!selection||selection.isCollapsed||!selection.toString().trim())return;
 const range=selection.getRangeAt(0);
 const words=$$('#reading-text .word').filter(word=>range.intersectsNode(word.querySelector('.word-text')));
 if(words.length<2)return;
 if(new Set(words.map(word=>word.dataset.sentence)).size!==1){toast('Please select a phrase within one sentence.');return;}
 const first=words[0],last=words.at(-1);
 const selected=rangeSelection(sentences,first.dataset.sentence,Number(first.dataset.index),Number(last.dataset.index));
 setTimeout(()=>{selection.removeAllRanges();anchor=null;lookup(selected);},0);
});
async function api(endpoint,data,signal){
 if(endpoint==='/api/speech')return audioCache.response(data,{account:dictionaryAccount(),signal,fetchAudio:()=>{
   if(!config.configured)throw new Error('Configure OpenRouter to hear new Swedish pronunciation.');
   return cloudEnabled?speechResponse(data,signal):localAPI(endpoint,data,signal);
 }});
 if(cloudEnabled)return cloudRequest(endpoint.replace('/api/',''),data,signal);
 return localAPI(endpoint,data,signal);
}
async function localAPI(endpoint,data,signal){
 const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json','X-App-Token':config.token||''},body:JSON.stringify(data),signal});
 if(!response.ok){const result=await response.json();throw new Error(result.error||'Request failed.');}return response;
}
async function lookup(selection, force=false){
 stopReaderSpeech();
 const id=++requestId;active=selection;
 const token=lookupTracker.begin(selection.id);pendingLookups.set(selection.id,selection);
 openDetails();
 const language='en',account=dictionaryAccount();
 $('#lookup-origin').textContent=force?'OpenRouter AI':'Local dictionary';
 $('#detail-content').innerHTML=`<div class="loading">Looking up <strong>${escape(selection.text)}</strong>…</div>`;
 try{
   const result=await dictionary.resolve(selection,{language,account,force,existing:entries.find(item=>item.id===selection.id),fetchAI:async()=>{
     if(!config.configured)throw new Error('No local dictionary entry. Configure OpenRouter to use AI lookup.');
     return (await api('/api/lookup',{text:selection.text,context:selection.context,language,refresh:force})).json();
   }});
   if(!lookupTracker.isCurrent(selection.id,token))return;
   const entry={...selection,...result,id:selection.id,language,documentId:currentDocument?.id||'sample',documentTitle:currentDocument?.title||'En sida i taget'};
   entries=upsertEntry(entries,entry);await persist();updateCount();
   visible=addVisible(visible,{...selection,translation:result.translation});renderReader();
   if(id===requestId){renderDetail(entries.find(item=>item.id===selection.id));void speakInReader(selection.text,selection.id,selection.context);}
 }catch(err){if(id===requestId&&lookupTracker.isCurrent(selection.id,token)){$('#detail-content').innerHTML=`<div class="detail"><h3>${escape(selection.text)}</h3><p class="error">${escape(err.message)}</p><button id="retry-lookup">Try again</button></div>`;$('#retry-lookup').onclick=()=>lookup(selection,force);}}
 finally{if(lookupTracker.isCurrent(selection.id,token))pendingLookups.delete(selection.id);}
}
function renderDetail(entry){
 active=entry;$('#lookup-origin').textContent=entrySource(entry);
 openDetails();
 $('#detail-content').innerHTML=`<div class="detail"><h3 lang="sv">${escape(entry.text)}</h3><p class="translation">${escape(entry.translation)}</p><p class="grammar">${escape(entry.lemma)} · ${escape(entry.grammar)}</p><blockquote lang="sv">${escape(entry.context)}</blockquote><h4>${entry.source==='dictionary'?'DICTIONARY MEANINGS':'IN THIS SENTENCE'}</h4><p class="explanation">${escape(entry.explanation)}</p>${entry.example?`<p class="example" lang="sv">${escape(entry.example)}</p>`:''}${entry.exampleTranslation?`<p class="source-note">${escape(entry.exampleTranslation)}</p>`:''}<p class="source-note">${entry.source==='dictionary'?`<a href="${dictionaryMetadata.sourceUrl}" target="_blank" rel="noopener noreferrer">Folkets lexikon</a> · <a href="${dictionaryMetadata.licenseUrl}" target="_blank" rel="noopener noreferrer">${dictionaryMetadata.license}</a>`:entry.source==='demo'?'Authored demo':`OpenRouter · ${escape(entry.model)} · ${entry.elapsedMs} ms`}</p><h4>YOUR NOTE</h4><label class="note-label">A thought worth keeping<textarea id="personal-note" rows="3" placeholder="A memory, a connection, your own example…">${escape(entry.note)}</textarea></label><p class="save-state" id="note-state">Saved on this device</p><div class="detail-actions"><button id="open-words">View in Words</button><button id="refresh-lookup">Ask AI</button></div></div>`;
 $('#personal-note').addEventListener('input',event=>{const item=entries.find(item=>item.id===entry.id);if(item)item.note=event.target.value;scheduleNoteSave($('#note-state'));});
 $('#personal-note').addEventListener('blur',()=>{clearTimeout(noteTimer);void persist();});
 const playButton=document.createElement('button');playButton.id='play-word';playButton.type='button';
 const heading=$('.detail h3'),headingRow=document.createElement('div');headingRow.className='word-detail-heading';heading.before(headingRow);headingRow.append(heading,playButton);playButton.onclick=()=>speakInReader(entry.text,entry.id,entry.context);
 const wordStatus=document.createElement('p');wordStatus.dataset.wordAudioStatus='';wordStatus.className='audio-status';wordStatus.setAttribute('role','status');headingRow.after(wordStatus);updateSpeechControls();
 $('#open-words').onclick=()=>showView('vocabulary');$('#refresh-lookup').onclick=()=>lookup(entry,true);
}
$$('[data-try]').forEach(button=>button.onclick=()=>{
 const text=button.dataset.try;
 for(const sentence of sentences){const words=tokenize(sentence.text).filter(t=>t.word);const at=sentence.text.indexOf(text);if(at>=0){const start=words.findIndex(t=>t.offset===at);const end=words.findIndex(t=>t.offset+t.text.length===at+text.length);if(start>=0&&end>=0)lookup(rangeSelection(sentences,sentence.id,start,end));break;}}
});
function vocabularyAnswer(entry) {
 const answer=entry.aiExplanation;
 return answer?`<p class="grammar">${escape(answer.lemma)} · ${escape(answer.grammar)}</p><p>${escape(answer.explanation)}</p><h4>SWEDISH EXAMPLE</h4><p class="example" lang="sv">${escape(answer.example)}</p><p class="source-note">OpenRouter · ${escape(answer.model)} · ${answer.language==='zh'?'中文':'English'}</p>`:'<p class="muted">Ask AI for a fresh explanation and a Swedish example in this sentence.</p>';
}
function renderVocabulary(){
 const query=$('#word-search').value.toLowerCase();const items=entries.filter(entry=>`${entry.text} ${entry.translation} ${entry.note}`.toLowerCase().includes(query));
 $('#vocabulary-list').innerHTML=items.length?items.map(entry=>{
   const expanded=expandedWords.has(entry.id),state=vocabularyAI.get(entry.id),busy=state?.pending;
   return `<article class="vocab-card${expanded?' is-expanded':''}" data-entry="${escape(entry.id)}"><div class="vocab-card-heading"><button type="button" class="vocab-expand" data-expand="${escape(entry.id)}" aria-expanded="${expanded}" aria-controls="vocab-details-${escape(entry.id)}" aria-label="${expanded?'Collapse':'Expand'} ${escape(entry.text)}"><span class="vocab-word" lang="sv">${escape(entry.text)}</span><span class="vocab-chevron" aria-hidden="true">${expanded?'−':'+'}</span><span class="vocab-meaning">${escape(entry.translation)}</span></button><button type="button" class="pronounce-button" data-pronounce="${escape(entry.id)}" aria-label="Pronounce ${escape(entry.text)}" aria-pressed="false">${speakerIcon}</button><button type="button" class="delete-word-button" data-delete-word="${escape(entry.id)}" aria-label="Delete ${escape(entry.text)}" title="Delete word"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/></svg></button></div><div class="vocab-card-meta"><span class="pill">${entrySource(entry)}</span>${entry.note?'<span class="note-indicator">Has a note</span>':''}</div><p class="context" lang="sv">${escape(entry.context)}</p><p data-vocab-audio-status="${escape(entry.id)}" class="audio-status" role="status" hidden></p><div class="vocab-details" id="vocab-details-${escape(entry.id)}" ${expanded?'':'hidden'}><h4>SAVED EXPLANATION</h4><p class="grammar">${escape(entry.lemma)} · ${escape(entry.grammar)}</p><p>${escape(entry.explanation)}</p>${entry.example?`<h4>SWEDISH EXAMPLE</h4><p class="example" lang="sv">${escape(entry.example)}</p>`:''}${entry.exampleTranslation?`<p class="source-note">${escape(entry.exampleTranslation)}</p>`:''}<div class="vocab-ai"><div class="vocab-ai-toolbar"><label>Explanation language<select data-vocab-language ${busy?'disabled':''}><option value="en" ${(entry.aiExplanation?.language||entry.language)!=='zh'?'selected':''}>English</option><option value="zh" ${(entry.aiExplanation?.language||entry.language)==='zh'?'selected':''}>中文</option></select></label><button type="button" data-ask-ai ${busy?'disabled':''}>${busy?'Asking AI…':state?.error?'Try AI again':'Ask AI'}</button></div><div class="vocab-ai-answer" aria-live="polite">${vocabularyAnswer(entry)}</div><p class="vocab-ai-status${state?.error?' error':''}" role="status">${escape(state?.error|| (busy?'Preparing an explanation and example…':''))}</p></div><label class="vocab-note-label">Your note<textarea data-vocab-note rows="3" placeholder="A memory, a connection, your own example…">${escape(entry.note)}</textarea></label><p class="save-state" data-vocab-note-state>Saved on this device</p></div></article>`;
 }).join(''):`<div class="empty-state">${entries.length?'No matching words.':'No saved words yet.'}</div>`;
 updateSpeechControls();
}
function toggleVocabularyCard(card) {
 const id=card.dataset.entry,expanded=!expandedWords.has(id);
 if(expanded)expandedWords.add(id);else expandedWords.delete(id);
 card.classList.toggle('is-expanded',expanded);card.querySelector('.vocab-details').hidden=!expanded;
 const button=card.querySelector('[data-expand]'),entry=entries.find(item=>item.id===id);
 button.setAttribute('aria-expanded',String(expanded));button.setAttribute('aria-label',`${expanded?'Collapse':'Expand'} ${entry.text}`);
 card.querySelector('.vocab-chevron').textContent=expanded?'−':'+';
}
async function askVocabularyAI(card) {
 const entry=entries.find(item=>item.id===card.dataset.entry);if(!entry||vocabularyAI.get(entry.id)?.pending)return;
 const state={pending:true,error:''};vocabularyAI.set(entry.id,state);
 const language=card.querySelector('[data-vocab-language]').value,account=dictionaryAccount();
 const update=()=>{
   const current=$$('[data-entry]').find(item=>item.dataset.entry===entry.id);if(!current)return;
   const button=current.querySelector('[data-ask-ai]');button.disabled=state.pending;button.textContent=state.pending?'Asking AI…':state.error?'Try AI again':'Ask AI';
   current.querySelector('[data-vocab-language]').disabled=state.pending;
   const status=current.querySelector('.vocab-ai-status');status.textContent=state.error||(state.pending?'Preparing an explanation and example…':'Explanation saved on this device.');status.classList.toggle('error',!!state.error);
   const savedEntry=entries.find(item=>item.id===entry.id);if(savedEntry)current.querySelector('.vocab-ai-answer').innerHTML=vocabularyAnswer(savedEntry);
 };
 update();
 try{
   if(!config.configured)throw new Error('Configure OpenRouter to ask AI about this word.');
   const result=await(await api('/api/lookup',{text:entry.text,context:entry.context,language,refresh:true})).json();
   await dictionary.remember(entry,result,{language,account});
   const current=entries.find(item=>item.id===entry.id);if(!current||vocabularyAI.get(entry.id)!==state)return;
   current.aiExplanation={...result,language,generatedAt:new Date().toISOString()};
   if(!await persist())state.error='The explanation arrived but could not be saved. Export your words before closing.';
 }catch(err){state.error=err.message;}
 finally{state.pending=false;update();}
}
$('#vocabulary-list').addEventListener('click',event=>{
 const card=event.target.closest('[data-entry]');if(!card)return;
 const entry=entries.find(item=>item.id===card.dataset.entry);if(!entry)return;
 const deleteButton=event.target.closest('[data-delete-word]');if(deleteButton){deleteButton.disabled=true;void undoLookup(entry);return;}
 if(event.target.closest('[data-pronounce]')){void speakInReader(entry.text,`vocab:${entry.id}`,entry.context);return;}
 if(event.target.closest('[data-ask-ai]')){void askVocabularyAI(card);return;}
 if(event.target.closest('[data-expand]')||!event.target.closest('button,input,textarea,select,label,a,.vocab-details'))toggleVocabularyCard(card);
});
$('#vocabulary-list').addEventListener('input',event=>{
 if(!event.target.matches('[data-vocab-note]'))return;
 const card=event.target.closest('[data-entry]'),entry=entries.find(item=>item.id===card.dataset.entry);if(!entry)return;
 entry.note=event.target.value;scheduleNoteSave(card.querySelector('[data-vocab-note-state]'));
 let indicator=card.querySelector('.note-indicator');if(!indicator&&entry.note){indicator=document.createElement('span');indicator.className='note-indicator';indicator.textContent='Has a note';card.querySelector('.vocab-card-meta').append(indicator);}else if(indicator&&!entry.note)indicator.remove();
});
$('#word-search').oninput=renderVocabulary;
function download(filename,data){const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('#export-words').onclick=()=>download('lasrum-vocabulary.json',{version:1,exportedAt:new Date().toISOString(),entries});
$('#passage').innerHTML=passages.map(p=>`<option value="${p.id}">${p.label}</option>`).join('');
function currentPassage(){return passages.find(p=>p.id===$('#passage').value);}
function renderPassage(){$('#passage-text').textContent=currentPassage().text;}
renderPassage();
$('#voice-candidates').innerHTML=candidates.map(c=>`<article class="voice-card" data-candidate="${c.id}"><span class="eyebrow">CANDIDATE ${c.id.toUpperCase()}</span><h3>${c.name}</h3><p class="muted">${c.description}</p><label>Voice ID<input id="voice-${c.id}" list="voice-options-${c.id}" placeholder="Load catalog or enter a voice ID" autocomplete="off"><datalist id="voice-options-${c.id}"></datalist></label><button id="generate-${c.id}" class="primary" disabled>Generate sample</button><audio id="audio-${c.id}" controls hidden preload="metadata"></audio><label>Listening speed<select id="speed-${c.id}"><option value="1">Normal · 1×</option><option value="0.8">Slower · 0.8×</option></select></label><p class="metrics" id="metrics-${c.id}">No sample generated.</p><div class="ratings">${['Pronunciation','Naturalness','Clarity','Consistency'].map(metric=>`<label>${metric}<select data-rating="${metric}" data-candidate="${c.id}" disabled><option value="">Not rated</option>${[1,2,3,4,5].map(n=>`<option value="${n}">${n} / 5</option>`).join('')}</select></label>`).join('')}</div></article>`).join('');
function currentResult(c){return evaluation.results.find(r=>r.candidate===c.id&&r.passageId===currentPassage().id&&r.voice===$(`#voice-${c.id}`).value.trim()&&r.model===c.model);}
function refreshRating(c){const result=currentResult(c);$$(`[data-rating][data-candidate="${c.id}"]`).forEach(select=>{select.disabled=!result;select.value=result?.ratings?.[select.dataset.rating]||'';});}
function resetAudio(c){const audio=$(`#audio-${c.id}`);audio.pause();audio.removeAttribute('src');audio.load();audio.hidden=true;if(audioURLs.has(c.id)){URL.revokeObjectURL(audioURLs.get(c.id));audioURLs.delete(c.id);}$(`#metrics-${c.id}`).textContent='Generate this passage to listen and compare.';refreshRating(c);}
$('#passage').onchange=()=>{renderPassage();candidates.forEach(resetAudio);};
for(const c of candidates){
 $(`#speed-${c.id}`).onchange=()=>{ $(`#audio-${c.id}`).playbackRate=Number($(`#speed-${c.id}`).value); };
 $(`#voice-${c.id}`).value=evaluation.voices?.[c.id]||c.voice;
 $(`#voice-${c.id}`).onchange=()=>{evaluation.voices={...evaluation.voices,[c.id]:$(`#voice-${c.id}`).value.trim()};persist();resetAudio(c);};
 $(`#generate-${c.id}`).onclick=async()=>{
   const button=$(`#generate-${c.id}`),voice=$(`#voice-${c.id}`).value.trim(),passage=currentPassage();
   if(!voice){toast('Choose a voice ID from the catalog first.');return;}
   button.disabled=true;button.textContent='Generating…';$(`#metrics-${c.id}`).textContent='Waiting for OpenRouter…';
   try{
     const response=await api('/api/speech',{model:c.model,voice,text:passage.text});
     const blob=await response.blob();
     const result={candidate:c.id,model:c.model,voice,passageId:passage.id,text:passage.text,generatedAt:new Date().toISOString(),elapsedMs:Number(response.headers.get('x-elapsed-ms')),cached:response.headers.get('x-audio-cache')==='hit',bytes:blob.size,ratings:{}};
     const old=evaluation.results.findIndex(r=>r.candidate===c.id&&r.model===c.model&&r.voice===voice&&r.passageId===passage.id);
     if(old>=0){result.ratings=evaluation.results[old].ratings;evaluation.results[old]=result;}else evaluation.results.push(result);
     persist();
     if(currentPassage().id===passage.id&&$(`#voice-${c.id}`).value.trim()===voice){
       resetAudio(c);const url=URL.createObjectURL(blob);audioURLs.set(c.id,url);const audio=$(`#audio-${c.id}`);audio.src=url;audio.playbackRate=Number($(`#speed-${c.id}`).value);audio.hidden=false;
       audio.onplay=()=>{stopReaderSpeech();candidates.filter(other=>other.id!==c.id).forEach(other=>$(`#audio-${other.id}`).pause());};
       $(`#metrics-${c.id}`).textContent=`${result.cached?'Cached audio':'New generation'} · ${(result.elapsedMs/1000).toFixed(1)} s · ${(blob.size/1024).toFixed(0)} KB. Use Play to listen.`;refreshRating(c);
     }
   }catch(err){$(`#metrics-${c.id}`).textContent=err.message;toast(err.message);}
   finally{button.disabled=!config.configured;button.textContent='Generate sample';}
 };
 refreshRating(c);
}
$$('[data-rating]').forEach(select=>select.onchange=()=>{const c=candidates.find(c=>c.id===select.dataset.candidate),result=currentResult(c);if(result){result.ratings[select.dataset.rating]=select.value?Number(select.value):null;persist();}});
$('#preferred').value=evaluation.preferred||'';$('#evaluation-notes').value=evaluation.notes||'';
$('#preferred').onchange=()=>{const selected=$('#preferred').value;const c=candidates.find(c=>c.id===selected);if(c&&!evaluation.results.some(r=>r.candidate===c.id&&r.voice===$(`#voice-${c.id}`).value.trim())){toast('Generate and listen to this candidate before choosing it.');$('#preferred').value=evaluation.preferred||'';return;}evaluation.preferred=selected;evaluation.preferredConfiguration=c?{model:c.model,voice:$(`#voice-${c.id}`).value.trim()}:null;persist();};
$('#evaluation-notes').oninput=()=>{evaluation.notes=$('#evaluation-notes').value;persist();};
$('#export-evaluation').onclick=()=>download('lasrum-phase0-evaluation.json',{version:1,exportedAt:new Date().toISOString(),...evaluation});
$('#load-voices').onclick=async()=>{
 const button=$('#load-voices');button.disabled=true;$('#catalog-state').textContent='Loading the public OpenRouter catalog…';
 try{
   const response=cloudEnabled?await cloudRequest('models'):await fetch('/api/models');const raw=await response.json();if(!response.ok)throw new Error(raw.error);
   const models=Array.isArray(raw)?raw:raw.data||raw.models||[];let found=0;
   for(const c of candidates){const model=models.find(m=>m.id===c.model);const speech=model?.output_modalities?.find(item=>item.type==='speech');const voices=speech?.supported_parameters?.voice?.values||[];
     $(`#voice-options-${c.id}`).innerHTML=voices.map(v=>`<option value="${escape(typeof v==='string'?v:v.id)}"></option>`).join('');found+=voices.length;
   }
   $('#catalog-state').textContent=found?`${found} voice options loaded. Choose an ID for each candidate. Swedish pronunciation still needs listening evaluation.`:'The catalog did not publish voice IDs for these candidates. Enter a valid provider voice ID; no voice has been assumed.';
 }catch(err){$('#catalog-state').textContent=`Catalog unavailable: ${err.message}`;}finally{button.disabled=false;}
};
articleMetadata();renderReader();updateCount();
async function loadConnection(){
 try{
   const response=cloudEnabled?await cloudRequest('app-config'):await fetch('/api/config');
   if(!response.ok)throw new Error('AI connection unavailable.');
   config=await response.json();
   $('#voice-notice').hidden=!!config.configured;
   $('#voice-notice').textContent=config.configured?'':'AI key not configured.';
   candidates.forEach(c=>$(`#generate-${c.id}`).disabled=!config.configured);
 }catch{
   $('#voice-notice').hidden=false;
   $('#voice-notice').textContent='AI connection unavailable. Retry or check configuration.';
 }
}
let noteTimer;
function scheduleNoteSave(label){
 label.textContent='Saving on this device…';
 void persist().then(saved=>{if(label.isConnected)label.textContent=saved?'Saved on this device':'Not saved — export a backup';});
 clearTimeout(noteTimer);noteTimer=setTimeout(()=>cloudRuntime?.engine?.sync(),800);
}
$('#vocabulary-list').addEventListener('focusout',event=>{if(event.target.matches('[data-vocab-note]')){clearTimeout(noteTimer);void persist().then(()=>cloudRuntime?.engine?.sync());}});
function applyCloudSnapshot(value,{preserveActive=true}={}){
 if(pendingLocalSaves){deferredRemote=true;return;}
 applyingRemote=true;
 const oldDocument=currentDocument,oldPage=currentPage,oldSentenceText=pageSpeechText(sentences);
 entries=value.entries||[];library=value.library||[];evaluation=value.evaluation||emptySnapshot().evaluation;readingProgress=value.readingProgress||{};
 currentDocument=library.find(item=>item.id===value.currentDocumentId&&!item.deletedAt)||null;
 // Never jump to a different article in the middle of reading because another device opened it.
 if(preserveActive&&oldDocument&&library.some(item=>item.id===oldDocument.id&&!item.deletedAt)&&!$('#reader-view').hidden)currentDocument=library.find(item=>item.id===oldDocument.id);
 readerPages=paginateSentences(currentDocument?articleSentences(currentDocument.text,currentDocument.id):sampleSentences);
 currentPage=preserveActive&&oldDocument?.id===currentDocument?.id&&!$('#reader-view').hidden?Math.min(oldPage,readerPages.length-1):restoredPage(readerPages,readingProgress[currentDocument?.id||'sample']);sentences=readerPages[currentPage];
 visible=visible.filter(item=>entries.some(entry=>entry.id===item.id));
 if(active&&!entries.some(entry=>entry.id===active.id)&&!pendingLookups.has(active.id)){active=null;closeDetails();$('#detail-content').innerHTML='<div class="empty-detail">Choose a word to explore its meaning.</div>';}
 if(oldSentenceText!==sentences.map(s=>s.text).join(' ')){visible=[];active=null;anchor=null;stopReaderSpeech();}
 articleMetadata();renderReader();updateCount();
 if(!$('#library-view').hidden)renderLibrary();
 const noteFocused=document.activeElement?.matches('[data-vocab-note]');
 if(!$('#vocabulary-view').hidden&&!noteFocused)renderVocabulary();
 $('#preferred').value=evaluation.preferred||'';if(document.activeElement!==$('#evaluation-notes'))$('#evaluation-notes').value=evaluation.notes||'';
 candidates.forEach(c=>{if(document.activeElement!==$(`#voice-${c.id}`))$(`#voice-${c.id}`).value=evaluation.voices?.[c.id]||c.voice;});
 lastAppSnapshot=snapshot();applyingRemote=false;
}
function syncStatus(status){
 const text=status.error?`Sync failed: ${status.error}`:status.conflicts.length?`${status.conflicts.length} conflict(s) to review`:status.offline?'Waiting for connection':status.pending?`Syncing ${status.pending} change(s)…`:status.lastSynced?'All changes synced':'Ready to sync';
 $('#sync-state').textContent=text;
 const container=$('#sync-conflicts');container.replaceChildren();
 for(const conflict of status.conflicts){const section=document.createElement('section');section.className='sync-conflict';const heading=document.createElement('h3');heading.textContent=`Conflicting changes: ${conflict.kind} · ${conflict.id}`;section.append(heading);
   const local=cloudRuntime.engine.state.snapshot,record=conflict.kind==='vocabulary'?local.entries.find(e=>e.id===conflict.id):conflict.kind==='articles'?local.library.find(e=>e.id===conflict.id):null;
   for(const [label,data] of [['Your device',record||'Deleted on this device'],['Cloud version',conflict.remote?.data||'Not present']]){const title=document.createElement('h4');title.textContent=label;const content=document.createElement('pre');content.textContent=typeof data==='string'?data:JSON.stringify(data,null,2);section.append(title,content);}
   for(const [label,choice] of [['Keep my version','mine'],['Use cloud version','cloud']]){const button=document.createElement('button');button.textContent=label;button.onclick=()=>cloudRuntime.resolve(conflict.kind,conflict.id,choice).catch(error=>toast(error.message));section.append(button);}container.append(section);
 }
 $('#conflict-panel').hidden=!status.conflicts.length;
}
$('#sign-in').onclick=()=>cloudRuntime?.login().catch(error=>$('#auth-message').textContent=error.message);
$('#sign-out').onclick=()=>cloudRuntime?.logout().catch(error=>toast(error.message));
$('#sync-now').onclick=()=>cloudRuntime?.engine?.sync();
$('#retry-auth').onclick=async()=>{const {data}=await cloudRuntime.client.auth.getSession();await cloudRuntime.acceptSession(data.session);};
$('#export-backup').onclick=()=>download('lasrum-complete-backup.json',{format:'lasrum-backup',version:1,exportedAt:new Date().toISOString(),snapshot:snapshot()});
$('#import-backup').onchange=async event=>{
 try{const file=event.target.files[0];if(!file)return;if(file.size>30*1024*1024)throw new Error('Choose a backup smaller than 30 MB.');backupDraft=validateBackup(JSON.parse(await file.text()));$('#backup-preview').hidden=false;$('#backup-summary').textContent=`Import ${backupDraft.library.length} articles and ${backupDraft.entries.length} vocabulary entries? Existing content is preserved; differing imported notes are appended.`;}
 catch(error){toast(error.message);}finally{event.target.value='';}
};
$('#cancel-backup').onclick=()=>{$('#backup-preview').hidden=true;backupDraft=null;};
$('#confirm-backup').onclick=async()=>{if(!backupDraft)return;const merged=mergeBackup(snapshot(),backupDraft);entries=merged.entries;library=merged.library;if(!currentDocument&&merged.currentDocumentId)currentDocument=library.find(item=>item.id===merged.currentDocumentId&&!item.deletedAt)||null;if(await persist()){$('#backup-preview').hidden=true;backupDraft=null;applyCloudSnapshot(snapshot());toast('Backup imported. Your original file is unchanged.');}};
let progressTimer;
window.addEventListener('scroll',()=>{
 if(applyingRemote||$('#workspace').hidden||$('#reader-view').hidden||(cloudEnabled&&!cloudRuntime?.user))return;
 clearTimeout(progressTimer);progressTimer=setTimeout(()=>{const sentence=$$('.sentence').find(el=>el.getBoundingClientRect().bottom>120);if(sentence){readingProgress[currentDocument?.id||'sample']={sentenceId:sentence.dataset.sentence,pageIndex:currentPage};void persist();}},1000);
},{passive:true});
lastAppSnapshot=snapshot();
if(cloudEnabled){
 $('#account-controls').hidden=false;$('#local-mode-label').hidden=true;$('.backup-menu>summary').textContent='Account';
 cloudRuntime=new CloudRuntime({onSnapshot:applyCloudSnapshot,onStatus:syncStatus,onAccess:(user,message)=>{
   $('#workspace').hidden=!user;$('#auth-gate').hidden=!!user;$('#sign-out').hidden=!user;$('#sync-now').hidden=!user;$('#export-backup').disabled=!user;$('#import-backup').disabled=!user;$('#account-email').textContent=user?.email||'';$('#auth-message').textContent=message||'Sign in with the Google account approved for your private reading room.';
   if(!user){stopReaderSpeech();++requestId;for(const id of pendingLookups.keys())lookupTracker.cancel(id);pendingLookups.clear();backupDraft=null;$('#backup-preview').hidden=true;$('#backup-summary').textContent='';$('#sync-conflicts').replaceChildren();$('#conflict-panel').hidden=true;$('#sync-state').textContent='Sign in to sync';expandedWords.clear();vocabularyAI.clear();entries=[];library=[];evaluation=emptySnapshot().evaluation;readingProgress={};currentDocument=null;readerPages=paginateSentences(sampleSentences);currentPage=0;sentences=readerPages[0];visible=[];active=null;articleMetadata();renderReader();updateCount();$('#vocabulary-list').replaceChildren();$('#library-list').replaceChildren();config={};lastAppSnapshot=snapshot();}
   else void loadConnection();
 }});
 void cloudRuntime.start().catch(error=>$('#auth-message').textContent=error.message);
}else{
 $('#local-mode-label').hidden=false;
 void(async()=>{try{const cached=await deviceDB.load('local-device');if(cached?.snapshot)applyCloudSnapshot(cached.snapshot,{preserveActive:false});else await deviceDB.save('local-device',{snapshot:snapshot()});}catch{toast('Could not open local storage. Export a backup before importing a long text.');}finally{$('#workspace').hidden=false;void loadConnection();}})();
}


void dictionary.start().then(()=>{$('#dictionary-state').textContent=`${dictionaryMetadata.formCount.toLocaleString()} Swedish words and forms · available locally`;}).catch(()=>{$('#dictionary-state').textContent='Dictionary download unavailable. Retry lookup when connected.';});
