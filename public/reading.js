import {cleanArticleText,articleSentences} from './library.js';
export const CHAPTER_CHARS=12000;
export const PAGE_CHARS=700;
export const MAX_TXT_BYTES=20*1024*1024;
const heading=/^(?:#{1,3}\s+\S.*|(?:kapitel|chapter)\s+(?:\d+|[ivxlcdm]+)\b.*|第[一二三四五六七八九十百千万零〇\d]+[章节回部].*)$/iu;
export function splitChapters(raw,max=CHAPTER_CHARS){
 const text=cleanArticleText(raw),starts=[0];let offset=0;
 for(const line of text.split('\n')){if(offset&&heading.test(line.trim()))starts.push(offset);offset+=line.length+1;}
 const chapters=[];
 for(let i=0;i<starts.length;i++){
   let remaining=text.slice(starts[i],starts[i+1]??text.length).trim();
   const firstLine=remaining.split('\n')[0].trim(),name=heading.test(firstLine)?firstLine.replace(/^#{1,3}\s+/,''):null;
   let part=0;
   while(remaining){
     let end=remaining.length;
     if(end>max){
       const window=remaining.slice(0,max+1);end=window.lastIndexOf('\n\n');
       if(end<max/2){const matches=[...window.matchAll(/[.!?…]["”')\]]*\s+/gu)];end=matches.at(-1)?.index??-1;if(end>=0)end+=matches.at(-1)[0].length;}
       if(end<max/2)end=Math.max(window.lastIndexOf(' '),window.lastIndexOf('\n'));
       if(end<=0)throw new Error('The text contains an unusually long word. Check the imported text.');
     }
     chapters.push({text:remaining.slice(0,end).trim(),name,part:++part});remaining=remaining.slice(end).trim();
   }
 }
 return chapters;
}
export function importDocuments(raw,{title,sourceType,sourceUrl=null},makeId=()=>crypto.randomUUID()){
 const pieces=splitChapters(raw),bookId=pieces.length>1?`book-${makeId()}`:null,createdAt=new Date().toISOString();
 return pieces.map((piece,index)=>{
   const id=`doc-${makeId()}`;articleSentences(piece.text,id);
   return {id,title:bookId?(piece.name?`${piece.name}${piece.part>1?` · Part ${piece.part}`:''}`:`Chapter ${index+1}`).slice(0,200):title,text:piece.text,sourceType,sourceUrl,createdAt,...(bookId?{bookId,bookTitle:title,chapterIndex:index,chapterCount:pieces.length}:{})};
 });
}
export function paginateSentences(sentences,max=PAGE_CHARS){
 const pages=[];let page=[],size=0;
 for(const sentence of sentences){if(page.length&&size+sentence.text.length+1>max){pages.push(page);page=[];size=0;}page.push(sentence);size+=sentence.text.length+1;}
 if(page.length)pages.push(page);return pages.length?pages:[[]];
}
export function restoredPage(pages,progress={}){
 if(progress.sentenceId){const index=pages.findIndex(page=>page.some(sentence=>sentence.id===progress.sentenceId));if(index>=0)return index;}
 return Math.max(0,Math.min(pages.length-1,Number.isInteger(progress.pageIndex)?progress.pageIndex:0));
}
export const pageSpeechText=page=>page.map(sentence=>sentence.text).join(' ');
export function libraryGroups(library,deleted=false,query=''){
 const groups=new Map();
 for(const document of library){if(!!document.deletedAt!==deleted)continue;const key=document.bookId||document.id;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(document);}
 return [...groups.values()].map(chapters=>{chapters.sort((a,b)=>(a.chapterIndex??0)-(b.chapterIndex??0));return {...chapters[0],title:chapters[0].bookTitle||chapters[0].title,chapters};}).filter(group=>!query||group.chapters.some(document=>`${group.title} ${document.title} ${document.text} ${document.sourceUrl||''}`.toLowerCase().includes(query)));
}
