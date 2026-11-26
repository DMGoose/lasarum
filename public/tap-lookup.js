// Delay dispatch until the rapid-tap gesture ends, so a phrase never generates
// intermediate single-word requests, audio or vocabulary entries.
export function createTapLookup({select,lookup,undo,existing,preview=()=>{},delay=450,setTimer=setTimeout,clearTimer=clearTimeout}){
 let draft=null,timer=null,pendingUndo=null;
 function cancel(){if(timer!==null)clearTimer(timer);timer=null;draft=null;pendingUndo=null;preview(null);}
 function flush(){const selection=draft,removed=pendingUndo;cancel();if(removed)undo(removed);else if(selection)lookup(selection);}
 return {
   get selection(){return draft;},cancel,flush,
   tap(sentenceId,index){
     if(draft&&draft.sentenceId!==sentenceId)flush();
     if(draft&&index>=draft.start&&index<=draft.end){cancel();return 'cancelled';}
     if(!draft)pendingUndo=existing(sentenceId,index)||null;else pendingUndo=null;
     draft=select(sentenceId,draft?Math.min(draft.start,index):index,draft?Math.max(draft.end,index):index);
     if(timer!==null)clearTimer(timer);preview(draft);timer=setTimer(flush,delay);return 'pending';
   }
 };
}
