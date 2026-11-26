export function localDay(date=new Date()){return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;}
export const reviewKey=id=>`practice:${id}`;
export const dailyLimit=settings=>Math.max(1,Math.min(100,Number(settings.practiceDailyLimit)||10));
export const difficultyOf=review=>['hard','medium','easy'].includes(review?.difficulty)?review.difficulty:review?.lastReviewedAt&&review.interval===0?'hard':'medium';
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
export function mountPractice({root,getEntries,getSettings,save,speak,speakerIcon}){
 let queue=[],day='',flipped=false,busy=false;
 function render(){
   const today=localDay(),entries=getEntries(),settings=getSettings(),plan=practicePlan(entries,settings,today);
   if(day!==today){day=today;queue=[];flipped=false;}
   const prior=queue[0];queue=plan.ids;
   if(prior&&prior!==queue[0])flipped=false;
   const entry=entries.find(item=>item.id===queue[0]);
   root.innerHTML=`<div class="section-head"><h2>Practice</h2><label class="practice-limit">Daily words<select aria-label="Daily words">${[...new Set([5,10,20,30,50,100,plan.limit])].sort((a,b)=>a-b).map(n=>`<option ${n===plan.limit?'selected':''} value="${n}">${n}</option>`).join('')}</select></label></div><p class="practice-progress" role="status">${Math.min(plan.completed,plan.limit)} / ${plan.limit} today</p>${entry?`<div class="practice-stage" data-practice-id="${escape(entry.id)}">${flipped?`<article class="practice-card practice-back"><div class="practice-heading"><h3 lang="sv">${escape(entry.text)}</h3><button type="button" class="pronounce-button" data-practice-pronounce="${escape(entry.id)}" aria-label="Pronounce ${escape(entry.text)}">${speakerIcon}</button><button type="button" data-flip>Show word</button></div><p data-practice-audio-status class="error" role="status"></p><p class="practice-translation">${escape(entry.translation)}</p><p class="grammar">${escape(entry.lemma)} · ${escape(entry.grammar)}</p><h4>From your reading</h4><blockquote lang="sv">${escape(entry.context)}</blockquote>${entry.documentTitle?`<p class="source-note">${escape(entry.documentTitle)}</p>`:''}<h4>Meaning and usage</h4><p class="explanation">${escape(entry.explanation)}</p>${entry.example?`<p class="example" lang="sv">${escape(entry.example)}</p>${entry.exampleTranslation?`<p>${escape(entry.exampleTranslation)}</p>`:''}`:''}${entry.aiExplanation?`<h4>AI explanation</h4><p>${escape(entry.aiExplanation.translation)}</p><p class="grammar">${escape(entry.aiExplanation.grammar)}</p><p>${escape(entry.aiExplanation.explanation)}</p><p class="example" lang="sv">${escape(entry.aiExplanation.example)}</p>`:''}<label>Your note<textarea data-practice-note rows="3">${escape(entry.note)}</textarea></label><div class="practice-rating"><button type="button" data-review="hard" ${busy?'disabled':''}>difficult</button><button type="button" data-review="medium">medium</button><button type="button" class="primary" data-review="easy" ${busy?'disabled':''}>easy</button></div></article>`:`<button type="button" class="practice-card practice-front" data-flip aria-label="Show answer for ${escape(entry.text)}"><span lang="sv">${escape(entry.text)}</span><small>Show answer</small></button>`}</div>`:`<div class="practice-empty">${!entries.length?'Save words while reading to start practicing.':plan.completed>=plan.limit?'Daily practice complete.':'No words due today.'}</div>`}`;
 }
 root.addEventListener('change',async event=>{
   if(event.target.matches('[aria-label="Daily words"]')){const settings=getSettings(),old=settings.practiceDailyLimit;settings.practiceDailyLimit=Number(event.target.value);if(!await save())settings.practiceDailyLimit=old;queue=[];flipped=false;render();}
   if(event.target.matches('[data-practice-note]')){const entry=getEntries().find(item=>item.id===queue[0]);if(entry){entry.note=event.target.value;await save();}}
 });
 root.addEventListener('click',async event=>{
   if(event.target.closest('[data-flip]')){flipped=!flipped;render();root.querySelector(flipped?'[data-flip]':'.practice-front')?.focus({preventScroll:true});return;}
   const entry=getEntries().find(item=>item.id===queue[0]);if(!entry)return;
   if(event.target.closest('[data-practice-pronounce]')){speak(entry);return;}
   const rating=event.target.closest('[data-review]');if(!rating||busy)return;
   busy=true;root.querySelectorAll('[data-review]').forEach(button=>button.disabled=true);
   const settings=getSettings(),key=reviewKey(entry.id),prior=settings[key];settings[key]=reviewed(prior,rating.dataset.review);
   if(await save()){queue.shift();flipped=false;}else if(prior)settings[key]=prior;else delete settings[key];
   busy=false;render();root.querySelector('.practice-front')?.focus({preventScroll:true});
 });
 return {render,reset(){queue=[];day='';flipped=false;}};
}
