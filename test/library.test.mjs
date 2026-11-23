import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanArticleText,articleSentences,speechChunks} from '../public/library.js';
import {fetchPublicArticle,isPublicAddress,webURL} from '../import-url.mjs';

test('TXT normalization preserves Swedish text and paragraph structure',()=>{
 const text=cleanArticleText('\uFEFFÅsa läser.\r\n\r\nGöteborg är stilla.\r\n');
 assert.equal(text,'Åsa läser.\n\nGöteborg är stilla.');
 assert.throws(()=>cleanArticleText('   '));assert.throws(()=>cleanArticleText('a'.repeat(100001)));assert.throws(()=>cleanArticleText('binary\0text'));
});
test('imported article locations stay stable and separate from other articles',()=>{
 const text='Åsa läser. Hon tycker om kaffe.\n\nGöteborg är stilla.';
 const one=articleSentences(text,'doc-one');
 assert.deepEqual(one,articleSentences(text,'doc-one'));
 assert.equal(one.length,3);assert.equal(one[2].paragraph,1);
 assert.notEqual(one[0].id,articleSentences(text,'doc-two')[0].id);
 assert.ok(articleSentences('ett '.repeat(1800),'long').every(s=>s.text.length<=2800));
});
test('long article speech chunks preserve every word within provider limits',()=>{
 const text='Det är en svensk mening. '.repeat(350),chunks=speechChunks(text);
 assert.ok(chunks.length>1);assert.ok(chunks.every(c=>c.length<=2800));
 assert.equal(chunks.join(' '),text.trim());
});
test('web importer rejects private, local, mapped, and non-web addresses',async()=>{
 for(const ip of ['127.0.0.1','10.0.0.1','169.254.169.254','172.16.0.1','192.168.1.1','100.64.0.1','::1','::ffff:127.0.0.1','fc00::1','2002:7f00:1::'])assert.equal(isPublicAddress(ip),false,ip);
 assert.equal(isPublicAddress('93.184.216.34'),true);assert.equal(isPublicAddress('2606:4700::1111'),true);
 assert.throws(()=>webURL('file:///etc/passwd'));assert.throws(()=>webURL('https://user:pass@example.com'));assert.throws(()=>webURL('https://example.com:8080'));
 let downloaded=false;
 await assert.rejects(()=>fetchPublicArticle('https://example.com',{resolveDNS:async()=>[{address:'127.0.0.1'}],downloadPage:async()=>{downloaded=true;}}),/public webpages/);
 assert.equal(downloaded,false);
});
test('redirect destinations are revalidated and public DNS is pinned to download',async()=>{
 const addresses=[];
 const result=await fetchPublicArticle('https://example.com/start',{
   resolveDNS:async()=>[{address:'93.184.216.34'}],
   downloadPage:async(url,address)=>{addresses.push(address);return url.pathname==='/start'?{status:302,location:'/article'}:{status:200,type:'text/html',body:'<article>Hej Sverige.</article>'};}
 });
 assert.equal(result.url,'https://example.com/article');assert.equal(addresses.length,2);assert.equal(addresses[1],'93.184.216.34');
 await assert.rejects(()=>fetchPublicArticle('https://example.com',{
   resolveDNS:async()=>[{address:'93.184.216.34'}],downloadPage:async()=>({status:302,location:'http://127.0.0.1/'})
 }),/public webpages/);
});
