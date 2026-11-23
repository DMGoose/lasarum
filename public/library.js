export const MAX_ARTICLE_LENGTH=100000;
export function cleanArticleText(text) {
 if(typeof text!=='string')throw new Error('Add some article text first.');
 const cleaned=text.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n').replace(/[\t\u00a0]/g,' ').replace(/[ ]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
 if(!cleaned||!/[\p{L}\p{N}]/u.test(cleaned))throw new Error('This article has no readable text.');
 if(cleaned.includes('\0'))throw new Error('This file does not look like plain text. Choose a UTF-8 TXT file.');
 if(cleaned.length>MAX_ARTICLE_LENGTH)throw new Error('This article is too long. Import up to 100,000 characters at a time.');
 return cleaned;
}
export function articleSentences(text,id) {
 const segmenter=new Intl.Segmenter('sv',{granularity:'sentence'}),result=[];
 cleanArticleText(text).split(/\n\s*\n/).forEach((paragraph,p)=>{
   for(const {segment} of segmenter.segment(paragraph.replace(/\n/g,' '))){
     // Keep lookup context within the API limit, including texts without punctuation.
     const words=segment.trim().split(/\s+/);let chunk='';
     for(const word of words){
       if(word.length>2800)throw new Error('The article contains an unusually long word. Check the imported text.');
       if(chunk&&chunk.length+word.length+1>2800){result.push({id:`${id}:s${result.length+1}`,paragraph:p,text:chunk});chunk='';}
       chunk+=(chunk?' ':'')+word;
     }
     if(chunk)result.push({id:`${id}:s${result.length+1}`,paragraph:p,text:chunk});
   }
 });
 return result;
}
export function speechChunks(text,max=2800) {
 const chunks=[];let chunk='';
 for(const word of text.split(/\s+/)){
   if(!word)continue;
   if(word.length>max)throw new Error('The text contains an unusually long word.');
   if(chunk&&chunk.length+word.length+1>max){chunks.push(chunk);chunk='';}
   chunk+=(chunk?' ':'')+word;
 }
 if(chunk)chunks.push(chunk);return chunks;
}
export function extractWebArticle(html,url) {
 // Never attach downloaded HTML to the live document: return strings only.
 const doc=new DOMParser().parseFromString(html,'text/html');
 const title=doc.querySelector('meta[property="og:title"]')?.getAttribute('content')||doc.querySelector('h1')?.textContent||doc.title||new URL(url).hostname;
 doc.querySelectorAll('script,style,noscript,iframe,object,embed,svg,nav,header,footer,aside,form,button,[hidden],[aria-hidden="true"],[role="navigation"],.mw-editsection,.noprint,.navbox,.metadata,.ambox,.mw-jump-link,#toc,.reflist,.catlinks,.mw-references-wrap,.printfooter,.mw-indicators,.mw-authority-control,.mw-portlet').forEach(node=>node.remove());
 const root=doc.querySelector('[itemprop="articleBody"],.mw-parser-output')||doc.querySelector('article')||doc.querySelector('main,[role="main"]')||doc.body;
 root.querySelectorAll('br').forEach(node=>node.replaceWith(doc.createTextNode('\n')));
 root.querySelectorAll('p,div,section,h1,h2,h3,h4,li,blockquote').forEach(node=>node.append(doc.createTextNode('\n\n')));
 const text=cleanArticleText(root.textContent.replace(/ +/g,' '));
 return {title:title.trim().slice(0,200),text,sourceUrl:url};
}
