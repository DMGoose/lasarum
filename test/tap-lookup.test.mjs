import test from 'node:test';
import assert from 'node:assert/strict';
import {createTapLookup} from '../public/tap-lookup.js';
import {rangeSelection} from '../public/core.js';
const sentences=[{id:'a',text:'Jag tycker om att läsa.'},{id:'b',text:'En lugn morgon.'}];
function setup(){let fire=null;const results=[],previews=[],undone=[];const ui=createTapLookup({select:(...args)=>rangeSelection(sentences,...args),lookup:s=>results.push(s),undo:s=>undone.push(s),existing:(id,index)=>id==='b'&&index===2?{id:'saved'}:null,preview:s=>previews.push(s),setTimer:callback=>{fire=callback;return callback;},clearTimer:()=>{fire=null;}});return {ui,results,previews,undone,tick:()=>fire?.()};}
test('single tap dispatches one lookup after the gesture ends',()=>{const s=setup();s.ui.tap('a',1);assert.equal(s.results.length,0);s.tick();assert.equal(s.results.length,1);assert.equal(s.results[0].text,'tycker');assert.equal(s.ui.selection,null);});
test('rapid taps coalesce into one Swedish phrase with no intermediate requests',()=>{const s=setup();s.ui.tap('a',1);s.ui.tap('a',2);assert.equal(s.results.length,0);assert.equal(s.ui.selection.text,'tycker om');s.tick();assert.deepEqual(s.results.map(x=>x.text),['tycker om']);});
test('reverse and multiple taps preserve original range and intervening words',()=>{const s=setup();s.ui.tap('a',4);s.ui.tap('a',2);s.ui.tap('a',1);s.tick();assert.equal(s.results[0].text,'tycker om att läsa');});
test('repeated tap cancels draft and existing translations undo after the gesture',()=>{const s=setup();s.ui.tap('a',1);assert.equal(s.ui.tap('a',1),'cancelled');s.tick();assert.equal(s.results.length,0);assert.equal(s.ui.tap('b',2),'pending');assert.equal(s.undone.length,0);s.tick();assert.deepEqual(s.undone,[{id:'saved'}]);});
test('different sentences remain separate lookups and a cancelled gesture never fires',()=>{const s=setup();s.ui.tap('a',1);s.ui.tap('b',0);assert.deepEqual(s.results.map(x=>x.text),['tycker']);s.tick();assert.deepEqual(s.results.map(x=>x.text),['tycker','En']);s.ui.tap('a',4);s.ui.cancel();s.tick();assert.equal(s.results.length,2);});

test('rapid phrase taps also work when the first word already has a translation',()=>{const s=setup();s.ui.tap('b',2);s.ui.tap('b',1);s.tick();assert.equal(s.undone.length,0);assert.deepEqual(s.results.map(x=>x.text),['lugn morgon']);});