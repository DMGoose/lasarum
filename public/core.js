export function tokenize(text) {
  return Array.from(new Intl.Segmenter('sv', { granularity: 'word' }).segment(text))
    .map(({segment, index, isWordLike}) => ({text: segment, offset: index, word: !!isWordLike}));
}
export function rangeSelection(sentences, sentenceId, start, end) {
  const sentence = sentences.find(s => s.id === sentenceId);
  if (!sentence) throw new Error('Unknown sentence.');
  const words = tokenize(sentence.text).filter(t => t.word);
  const lo = Math.min(start, end), hi = Math.max(start, end);
  if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo < 0 || hi >= words.length) throw new Error('Invalid word range.');
  const text = sentence.text.slice(words[lo].offset, words[hi].offset + words[hi].text.length);
  return {id: `${sentenceId}:${lo}:${hi}`, sentenceId, start: lo, end: hi, text, context: sentence.text};
}
export function addVisible(previous, next) {
  return [...previous.filter(item => item.sentenceId !== next.sentenceId || item.end < next.start || item.start > next.end), next];
}
export function upsertEntry(entries, entry) {
  const existing = entries.find(item => item.id === entry.id);
  return existing ? entries.map(item => item.id === entry.id ? {...item, ...entry, createdAt:item.createdAt, note: item.note || ''} : item) : [...entries, {...entry, createdAt:entry.createdAt||new Date().toISOString(), note: ''}];
}
export function sortVocabulary(entries,newest=true){
 const time=entry=>Number.isFinite(Date.parse(entry.createdAt))?Date.parse(entry.createdAt):0;
 return entries.map((entry,index)=>({entry,index})).sort((a,b)=>(newest?-1:1)*(time(a.entry)-time(b.entry)||a.index-b.index)).map(item=>item.entry);
}
// A token is valid only until this exact selection is retried or removed.
export function createLookupTracker() {
 const tokens = new Map();
 return {
   begin(id) { const token = Symbol(id); tokens.set(id, token); return token; },
   isCurrent(id, token) { return tokens.get(id) === token; },
   cancel(id) { tokens.delete(id); }
 };
}
export function removeLookup(entries, visible, id) {
 return {entries: entries.filter(item=>item.id!==id), visible: visible.filter(item=>item.id!==id)};
}
