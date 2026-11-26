import test from 'node:test';
import assert from 'node:assert/strict';
import {importDocuments,splitChapters,paginateSentences,restoredPage,pageSpeechText,libraryGroups,CHAPTER_CHARS,PAGE_CHARS} from '../public/reading.js';
import {articleSentences} from '../public/library.js';
import {emptySnapshot,validateBackup,mergeBackup} from '../public/sync-core.js';
import {LocalDatabase} from '../public/local-db.js';
import {indexedDB} from 'fake-indexeddb';
const words=value=>value.replace(/\s+/g,' ').trim();
test('long imports preserve every word, recognize chapter headings and fit cloud record limits',()=>{
 const text='Förord.\n\nKapitel 1 — Morgon\n\n'+('Åsa läser en svensk bok.\n\n'.repeat(2400))+'\nKapitel 2 — Kväll\n\n'+('Göteborg är stilla.\n'.repeat(2400));
 let id=0;const documents=importDocuments(text,{title:'En lång bok',sourceType:'txt'},()=>String(++id));
 assert.ok(text.length>100000);assert.ok(documents.length>8);assert.equal(new Set(documents.map(d=>d.bookId)).size,1);
 assert.equal(words(documents.map(d=>d.text).join(' ')),words(text));
 assert.ok(documents.every((d,i)=>d.text.length<=CHAPTER_CHARS&&d.chapterIndex===i&&d.chapterCount===documents.length));
 assert.ok(documents.some(d=>d.title.startsWith('Kapitel 2')));
 const snapshot={...emptySnapshot(),library:documents,currentDocumentId:documents[3].id,readingProgress:{[documents[3].id]:{pageIndex:1}}};
 assert.equal(validateBackup({format:'lasrum-backup',snapshot}).library.length,documents.length);
 const restored=mergeBackup(emptySnapshot(),snapshot);assert.equal(restored.library[3].bookId,documents[3].bookId);assert.equal(restored.readingProgress[documents[3].id].pageIndex,1);
});
test('unheaded long texts split safely and short articles remain a single normal record',()=>{
 const raw='Ett litet stycke utan rubrik. '.repeat(1500),chapters=splitChapters(raw);
 assert.ok(chapters.length>1);assert.equal(words(chapters.map(c=>c.text).join(' ')),words(raw));
 const single=importDocuments('Hej Sverige.',{title:'Hej',sourceType:'paste'});assert.equal(single.length,1);assert.equal(single[0].bookId,undefined);assert.equal(single[0].title,'Hej');
});
test('pagination keeps lookup IDs stable, restores the right page, and speech contains only that page',()=>{
 const sentences=articleSentences('Åsa läser. Hon tycker om svenska. '.repeat(400),'chapter-one'),pages=paginateSentences(sentences);
 assert.ok(pages.length>3);assert.deepEqual(pages.flat(),sentences);
 assert.ok(pages.every(page=>pageSpeechText(page).length<=PAGE_CHARS));
 const target=2,progress={pageIndex:0,sentenceId:pages[target][2].id};assert.equal(restoredPage(pages,progress),target);
 assert.equal(restoredPage(pages,{pageIndex:99999}),pages.length-1);
 const spoken=pageSpeechText(pages[target]);assert.notEqual(spoken,pageSpeechText(sentences));assert.equal(spoken,pages[target].map(s=>s.text).join(' '));
});
test('library groups chapter records into one book and respects soft deletion',()=>{
 const documents=importDocuments('En svensk mening. '.repeat(2200),{title:'Testbok',sourceType:'txt'});
 assert.equal(libraryGroups(documents).length,1);assert.equal(libraryGroups(documents)[0].title,'Testbok');assert.equal(libraryGroups(documents)[0].chapters.length,documents.length);
 assert.equal(libraryGroups(documents,false,'testbok').length,1);
 for(const d of documents)d.deletedAt=new Date().toISOString();assert.equal(libraryGroups(documents).length,0);assert.equal(libraryGroups(documents,true).length,1);
});
test('device IndexedDB can save a long book beyond localStorage capacity and survive reopening',async()=>{
 const db=new LocalDatabase(indexedDB);const snapshot={...emptySnapshot(),library:importDocuments('Svenska ord. '.repeat(250000),{title:'Stor bok',sourceType:'txt'})};
 await db.save('large-local-book',{snapshot});db.close();const reopened=new LocalDatabase(indexedDB);const saved=await reopened.load('large-local-book');
 assert.equal(saved.snapshot.library.length,snapshot.library.length);assert.equal(saved.snapshot.library.map(d=>d.text).join(' '),snapshot.library.map(d=>d.text).join(' '));reopened.close();
});

test('the extended reading sample supports several pages without changing original lookup IDs',async()=>{
 const {sentences}=await import('../public/sample.js');const pages=paginateSentences(sentences);
 assert.ok(pages.length>=4);assert.deepEqual(pages.flat(),sentences);assert.equal(sentences[0].id,'s1');assert.equal(sentences[7].id,'s8');assert.equal(new Set(sentences.map(s=>s.id)).size,sentences.length);
 assert.notEqual(pageSpeechText(pages[0]),pageSpeechText(pages[1]));
});
