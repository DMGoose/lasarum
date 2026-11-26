export function localDay(date=new Date()){return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;}
export const reviewKey=id=>`practice:${id}`;
export const dailyLimit=settings=>Math.max(1,Math.min(100,Number(settings.practiceDailyLimit)||10));
export const practiceCategory=review=>['hard','medium','easy'].includes(review?.difficulty)?review.difficulty:review?.lastReviewedAt&&Number.isFinite(review.interval)?review.interval===0?'hard':'medium':'unclassified';
export const difficultyOf=review=>practiceCategory(review)==='unclassified'?'medium':practiceCategory(review);
export function practiceGroups(entries,settings){const groups={hard:[],medium:[],easy:[],unclassified:[]};for(const entry of entries)groups[practiceCategory(settings[reviewKey(entry.id)])].push(entry);return groups;}
const dailyRank=(day,id)=>{let hash=2166136261;for(const c of `${day}:${id}`)hash=Math.imul(hash^c.charCodeAt(0),16777619);return hash>>>0;};
export function practicePlan(entries,settings,day=localDay()){
 const completed=entries.filter(entry=>settings[reviewKey(entry.id)]?.completedDay===day).length;
 const priority={hard:0,medium:1,easy:2};
 const due=entries.filter(entry=>settings[reviewKey(entry.id)]?.completedDay!==day).sort((a,b)=>{
   const first=settings[reviewKey(a.id)],second=settings[reviewKey(b.id)];
   return priority[difficultyOf(first)]-priority[difficultyOf(second)]||String(first?.lastReviewedAt||'').localeCompare(String(second?.lastReviewedAt||''))||dailyRank(day,a.id)-dailyRank(day,b.id)||a.id.localeCompare(b.id);
 });
 return {completed,limit:dailyLimit(settings),ids:due.slice(0,Math.max(0,dailyLimit(settings)-completed)).map(entry=>entry.id)};
}
export function reviewed(previous={},difficulty,date=new Date()){
 if(!['hard','medium','easy'].includes(difficulty))throw new Error('Choose hard, medium or easy.');
 const {interval,dueDay,...saved}=previous;
 return {...saved,difficulty,completedDay:localDay(date),lastReviewedAt:date.toISOString()};
}
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// Split long text into screen-sized chunks without discarding any characters.
export function practiceTextPages(text,fits){
 const tokens=String(text).match(/\s+|\S+/gu)||[],pages=[];let start=0;
 while(start<tokens.length){let low=start+1,high=tokens.length,best=start;
   while(low<=high){const middle=Math.floor((low+high)/2);if(fits(tokens.slice(start,middle).join(''))){best=middle;low=middle+1;}else high=middle-1;}
   if(best>start){pages.push(tokens.slice(start,best).join(''));start=best;continue;}
   const chars=Array.from(tokens[start]);let from=0;while(from<chars.length){let lo=from+1,hi=chars.length,end=from+1;while(lo<=hi){const middle=Math.floor((lo+hi)/2);if(fits(chars.slice(from,middle).join(''))){end=middle;lo=middle+1;}else hi=middle-1;}pages.push(chars.slice(from,end).join(''));from=end;}start++;
 }
 return pages.length?pages:[''];
}
export function practiceSections(entry){return [
 {id:'meaning',label:'Meaning',text:[entry.text,entry.translation,[entry.lemma,entry.grammar].filter(Boolean).join(' · '),entry.explanation].filter(Boolean).join('\n\n')},
 {id:'examples',label:'Examples',text:['From your reading',entry.context,entry.documentTitle,entry.example?'Another example':null,entry.example,entry.exampleTranslation].filter(Boolean).join('\n\n')},
 ...(entry.aiExplanation?[{id:'ai',label:'AI',text:[entry.aiExplanation.question,entry.aiExplanation.translation,[entry.aiExplanation.lemma,entry.aiExplanation.grammar].filter(Boolean).join(' · '),entry.aiExplanation.explanation,entry.aiExplanation.example,entry.aiExplanation.exampleTranslation].filter(Boolean).join('\n\n')}]:[]),
 {id:'notes',label:'Notes',text:entry.note||'No notes yet.'}
];}
export function mountPractice({root,getEntries,getSettings,save,speak,speakerIcon,canSpeak=()=>true,onExit=()=>{},onPause=()=>{}}){
 let queue=[],day='',flipped=false,busy=false,lastSpoken=null,tab='examples',page=0,pages=[],editing=false,browsing=false,category='unclassified',categoryPage=0,search='';
 const current=()=>getEntries().find(entry=>entry.id===queue[0]);
 function renderCategoryRows(){
   const list=root.querySelector('[data-category-list]');if(!list?.getBoundingClientRect)return;
   const groups=practiceGroups(getEntries(),getSettings()),query=search.trim().toLocaleLowerCase('sv'),words=groups[category].filter(entry=>`${entry.text} ${entry.translation}`.toLocaleLowerCase('sv').includes(query));
   const size=Math.max(1,Math.floor(list.clientHeight/68)),count=Math.max(1,Math.ceil(words.length/size));categoryPage=Math.min(categoryPage,count-1);
   list.innerHTML=words.length?words.slice(categoryPage*size,(categoryPage+1)*size).map(entry=>`<article class="practice-category-row"><div><strong lang="sv" title="${escape(entry.text)}">${escape(entry.text)}</strong><span title="${escape(entry.translation)}">${escape(entry.translation)}</span></div><button type="button" class="pronounce-button" data-practice-pronounce="${escape(entry.id)}" aria-label="Pronounce ${escape(entry.text)}">${speakerIcon}</button></article>`).join(''):`<p class="practice-category-empty">${query?'No matching words.':'No words in this category yet.'}</p>`;
   root.querySelector('[data-category-page-label]').textContent=`${words.length} ${words.length===1?'word':'words'} · ${categoryPage+1} / ${count}`;
   root.querySelector('[data-category-step="-1"]').disabled=categoryPage===0;root.querySelector('[data-category-step="1"]').disabled=categoryPage===count-1;
 }
 function renderCategories(){
   const groups=practiceGroups(getEntries(),getSettings());
   root.innerHTML=`<header class="practice-session-bar"><button type="button" data-close-categories aria-label="Back to flashcards">←</button><h2>Word categories</h2><button type="button" data-exit-practice aria-label="Exit practice">×</button></header><section class="practice-category-browser"><div class="practice-category-tabs" aria-label="Word categories">${[['hard','difficult'],['medium','medium'],['easy','easy'],['unclassified','unclassified']].map(([id,label])=>`<button type="button" data-category="${id}" aria-pressed="${category===id}"><span>${label}</span><strong>${groups[id].length}</strong></button>`).join('')}</div><input type="search" data-category-search aria-label="Search category words" placeholder="Find a word…" value="${escape(search)}"><div data-category-list class="practice-category-list" aria-live="polite"></div></section><footer class="practice-category-navigation practice-session-footer"><button type="button" data-category-step="-1" aria-label="Previous words">←</button><span data-category-page-label role="status"></span><button type="button" data-category-step="1" aria-label="Next words">→</button></footer>`;
   renderCategoryRows();
 }
 function fitPane(){
   if(browsing){renderCategoryRows();return;}
   const copy=root.querySelector('[data-practice-copy]');if(!copy?.getBoundingClientRect||root.hidden||editing)return;
   const section=practiceSections(current()||{}).find(item=>item.id===tab);if(!section)return;
   const navigation=root.querySelector('.practice-pane-pages');navigation.hidden=false;
   pages=practiceTextPages(section.text,text=>{copy.textContent=text;return copy.scrollHeight<=copy.clientHeight+1;});page=Math.min(page,pages.length-1);copy.textContent=pages[page];navigation.style.visibility=pages.length<2?'hidden':'visible';
   root.querySelector('[data-pane-label]').textContent=`${page+1} / ${pages.length}`;
   root.querySelector('[data-pane-step="-1"]').disabled=page===0;root.querySelector('[data-pane-step="1"]').disabled=page===pages.length-1;
 }
 function render(){
   if(browsing){renderCategories();return;}
   const today=localDay(),entries=getEntries(),settings=getSettings(),plan=practicePlan(entries,settings,today);
   if(day!==today){day=today;queue=[];flipped=false;}
   const prior=queue[0];queue=plan.ids;
   if(prior&&prior!==queue[0]){flipped=false;tab='examples';page=0;editing=false;}
   const entry=current(),sections=entry?practiceSections(entry):[];
   if(!sections.some(section=>section.id===tab))tab='examples';
   root.innerHTML=`<header class="practice-session-bar"><button type="button" data-exit-practice aria-label="Exit practice">×</button><h2>Practice</h2><button type="button" class="practice-categories-trigger" data-open-categories aria-label="Browse word categories" title="Word categories">☷</button><span class="practice-progress" role="status">${Math.min(plan.completed,plan.limit)} / ${plan.limit}</span><select class="practice-daily-select" aria-label="Daily words">${[...new Set([5,10,20,30,50,100,plan.limit])].sort((a,b)=>a-b).map(n=>`<option ${n===plan.limit?'selected':''} value="${n}">${n} / day</option>`).join('')}</select></header>${entry?`<div class="practice-stage" data-practice-id="${escape(entry.id)}">${flipped?`<article class="practice-card practice-back"><div class="practice-heading"><h3 lang="sv">${escape(entry.text)}</h3><button type="button" class="pronounce-button" data-practice-pronounce="${escape(entry.id)}" aria-label="Pronounce ${escape(entry.text)}">${speakerIcon}</button><button type="button" data-flip>Show word</button></div><p data-practice-audio-status class="error" role="status"></p><p class="practice-brief">${escape(entry.translation)}</p><div class="practice-tabs" role="tablist" aria-label="Word details">${sections.map(section=>`<button type="button" role="tab" id="practice-tab-${section.id}" data-practice-tab="${section.id}" aria-selected="${tab===section.id}" aria-controls="practice-pane">${section.label}</button>`).join('')}</div><section id="practice-pane" class="practice-pane" role="tabpanel" aria-labelledby="practice-tab-${tab}">${editing&&tab==='notes'?`<label class="practice-note-editor">Your note<textarea data-practice-note aria-label="Your note">${escape(entry.note)}</textarea></label>`:'<div class="practice-copy" data-practice-copy></div>'}<nav class="practice-pane-pages" aria-label="Detail pages" hidden><button type="button" data-pane-step="-1" aria-label="Previous detail page">←</button><span data-pane-label></span><button type="button" data-pane-step="1" aria-label="Next detail page">→</button></nav>${tab==='notes'?`<button type="button" data-edit-note>${editing?'Save note':'Edit note'}</button>`:''}</section></article>`:`<div class="practice-card practice-front"><div class="practice-front-heading"><button type="button" class="practice-flip-word" data-flip aria-label="Show answer for ${escape(entry.text)}"><span lang="sv">${escape(entry.text)}</span></button><button type="button" class="pronounce-button" data-practice-pronounce="${escape(entry.id)}" aria-label="Pronounce ${escape(entry.text)}">${speakerIcon}</button></div><p data-practice-audio-status class="error" role="status"></p></div>`}</div><footer class="practice-session-footer">${flipped?`<div class="practice-rating">${[['hard','difficult'],['medium','medium'],['easy','easy']].map(([grade,label])=>`<button type="button" data-review="${grade}" ${busy?'disabled':''}>${label}</button>`).join('')}</div>`:'<button type="button" class="primary practice-show-answer" data-flip>Show answer</button>'}</footer>`:`<div class="practice-empty">${!entries.length?'Save words while reading to start practicing.':plan.completed>=plan.limit?'Daily practice complete.':'No words due today.'}</div><footer class="practice-session-footer"><button type="button" data-exit-practice>Done</button></footer>`}`;
   if(flipped)fitPane();
   if(entry&&!root.hidden&&canSpeak()&&lastSpoken!==entry.id){lastSpoken=entry.id;speak(entry);}
 }
 root.addEventListener('input',event=>{if(event.target.matches('[data-category-search]')){search=event.target.value;categoryPage=0;renderCategoryRows();return;}if(event.target.matches('[data-practice-note]')&&current())current().note=event.target.value;});
 root.addEventListener('change',async event=>{
   if(event.target.matches('[aria-label="Daily words"]')){const settings=getSettings(),old=settings.practiceDailyLimit;settings.practiceDailyLimit=Number(event.target.value);if(!await save())settings.practiceDailyLimit=old;queue=[];flipped=false;render();}
   if(event.target.matches('[data-practice-note]')&&current()){current().note=event.target.value;await save();}
 });
 root.addEventListener('keydown',event=>{
   if(event.key==='Escape'){onExit();return;}
   const button=event.target.closest('[data-practice-tab]');if(button&&['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();const sections=practiceSections(current()),index=sections.findIndex(item=>item.id===tab);tab=sections[(index+(event.key==='ArrowRight'?1:sections.length-1))%sections.length].id;page=0;editing=false;render();root.querySelector(`[data-practice-tab="${tab}"]`)?.focus();}
 });
 root.addEventListener('click',async event=>{
   if(event.target.closest('[data-exit-practice]')){if(editing)await save();onExit();return;}
   if(event.target.closest('[data-open-categories]')){if(editing&&!await save())return;editing=false;browsing=true;onPause();render();return;}
   if(event.target.closest('[data-close-categories]')){browsing=false;lastSpoken=null;render();return;}
   const group=event.target.closest('[data-category]');if(group){category=group.dataset.category;categoryPage=0;renderCategories();return;}
   const groupStep=event.target.closest('[data-category-step]');if(groupStep){categoryPage=Math.max(0,categoryPage+Number(groupStep.dataset.categoryStep));renderCategoryRows();return;}
   if(browsing){const voice=event.target.closest('[data-practice-pronounce]'),entry=voice&&getEntries().find(item=>item.id===voice.dataset.practicePronounce);if(entry)speak(entry);return;}
   const paneButton=event.target.closest('[data-practice-tab]');if(paneButton){if(editing)await save();tab=paneButton.dataset.practiceTab;page=0;editing=false;render();root.querySelector(`[data-practice-tab="${tab}"]`)?.focus({preventScroll:true});return;}
   const step=event.target.closest('[data-pane-step]');if(step){page=Math.max(0,Math.min(pages.length-1,page+Number(step.dataset.paneStep)));fitPane();return;}
   if(event.target.closest('[data-edit-note]')){if(editing&&!await save())return;editing=!editing;render();if(editing)root.querySelector('[data-practice-note]')?.focus();return;}
   if(event.target.closest('[data-flip]')){flipped=!flipped;editing=false;render();root.querySelector(flipped?'[data-flip]':'.practice-front [data-flip]')?.focus({preventScroll:true});return;}
   const entry=current();if(!entry)return;
   if(event.target.closest('[data-practice-pronounce]')){speak(entry);return;}
   const rating=event.target.closest('[data-review]');if(!rating||busy)return;
   busy=true;root.querySelectorAll('[data-review]').forEach(button=>button.disabled=true);
   const settings=getSettings(),key=reviewKey(entry.id),prior=settings[key];settings[key]=reviewed(prior,rating.dataset.review);
   if(await save()){queue.shift();flipped=false;tab='examples';page=0;editing=false;}else if(prior)settings[key]=prior;else delete settings[key];
   busy=false;render();root.querySelector('.practice-front [data-flip]')?.focus({preventScroll:true});
 });
 globalThis.window?.addEventListener('resize',fitPane);
 return {render,leave(){lastSpoken=null;flipped=false;editing=false;browsing=false;tab='examples';page=0;},reset(){queue=[];day='';flipped=false;lastSpoken=null;tab='examples';page=0;editing=false;browsing=false;category='unclassified';categoryPage=0;search='';}};
}
