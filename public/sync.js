import {KINDS,clone,equal,recordKey,emptySnapshot,snapshotRecords,recordsSnapshot,diffSnapshots,overlayRows,rebaseOperation,patchBetween} from './sync-core.js';
import {LocalDatabase} from './local-db.js';
export class SyncEngine{
 constructor({account,remote,db=new LocalDatabase(),onSnapshot=()=>{},onStatus=()=>{}}){Object.assign(this,{account,remote,db,onSnapshot,onStatus});this.state={rows:[],pending:[],conflicts:[],snapshot:emptySnapshot()};this.serial=Promise.resolve();this.stopped=false;}
 get rows(){return new Map(this.state.rows.map(row=>[recordKey(row.kind,row.id),row]));}
 async start(){this.state=await this.db.load(this.account)||this.state;this.onSnapshot(clone(this.state.snapshot));this.status();return clone(this.state.snapshot);}
 transaction(action){const next=this.serial.then(action);this.serial=next.catch(()=>{});return next;}
 status(error){this.onStatus({pending:this.state.pending.length,conflicts:clone(this.state.conflicts),error:error?.message||'',lastSynced:this.state.lastSynced||null,offline:globalThis.navigator?.onLine===false});}
 async save(snapshot,beforeSnapshot){return this.transaction(async()=>{
   if(this.stopped)throw new Error('Sign in again before saving.');
   const previous=clone(this.state),ops=diffSnapshots(beforeSnapshot||this.state.snapshot,snapshot,this.rows);
   for(const op of ops){const last=this.state.pending.findLast(item=>item.kind===op.kind&&item.id===op.id);if(last&&!last.attempted)Object.assign(last.patch,op.patch);else this.state.pending.push(op);}
   this.state.snapshot=recordsSnapshot(overlayRows(this.rows,this.state.pending));
   try{await this.db.save(this.account,this.state);}catch(error){this.state=previous;this.status(error);throw error;}
   this.status();
 });}
 async sync(){
   if(this.stopped||this.syncing)return this.syncing;
   this.syncing=this.runSync().finally(()=>{this.syncing=null;});return this.syncing;
 }
 async runSync(){
   try{
     if(globalThis.navigator?.onLine===false){this.status();return;}
     const headers=await this.remote.index();
     const needed=headers.filter(header=>this.rows.get(recordKey(header.kind,header.id))?.version!==header.version);
     const fetched=await this.remote.read(needed);
     await this.transaction(async()=>{if(this.stopped)return;const rows=this.rows;for(const row of fetched)rows.set(recordKey(row.kind,row.id),row);this.state.rows=[...rows.values()];this.rebuild();await this.db.save(this.account,this.state);});
     while(!this.stopped){
       const op=await this.transaction(async()=>{const pending=this.state.pending.find(item=>!this.state.conflicts.some(c=>c.kind===item.kind&&c.id===item.id));if(pending){pending.attempted=true;await this.db.save(this.account,this.state);}return clone(pending);});
       if(!op)break;
       const result=await this.remote.apply(op);
       await this.transaction(async()=>{
         if(this.stopped)return;const rows=this.rows,key=recordKey(op.kind,op.id);
         if(result.record)rows.set(key,{...result.record,kind:op.kind});this.state.rows=[...rows.values()];
         const at=this.state.pending.findIndex(item=>item.opId===op.opId);if(at<0)return;
         if(result.status==='applied')this.state.pending.splice(at,1);
         else{
           const rebased=rebaseOperation(op,result.record);
           if(!rebased.conflict)this.state.pending[at]={...rebased.operation,opId:crypto.randomUUID()};
           else if(op.kind==='reading_progress'||(op.kind==='user_settings'&&op.id==='currentDocumentId'))this.state.pending.splice(at,1);
           else this.state.conflicts.push({kind:op.kind,id:op.id,remote:result.record,createdAt:new Date().toISOString()});
         }
         this.rebuild();await this.db.save(this.account,this.state);this.status();
       });
     }
     await this.transaction(async()=>{if(this.stopped)return;this.state.lastSynced=new Date().toISOString();await this.db.save(this.account,this.state);this.status();});
   }catch(error){this.status(error);}
 }
 rebuild(){this.state.snapshot=recordsSnapshot(overlayRows(this.rows,this.state.pending));this.onSnapshot(clone(this.state.snapshot));}
 async resolve(kind,id,choice){return this.transaction(async()=>{
   const key=recordKey(kind,id),local=overlayRows(this.rows,this.state.pending).get(key),remote=this.rows.get(key);
   this.state.pending=this.state.pending.filter(op=>op.kind!==kind||op.id!==id);this.state.conflicts=this.state.conflicts.filter(c=>c.kind!==kind||c.id!==id);
   if(choice==='mine'&&local){const data=local.data,patch=patchBetween(remote?.data||{},data);if(Object.keys(patch).length)this.state.pending.push({opId:crypto.randomUUID(),kind,id,baseVersion:remote?.version||0,baseData:clone(remote?.data||{}),patch});}
   this.rebuild();await this.db.save(this.account,this.state);this.status();
 });}
 async stop(){this.stopped=true;await this.serial;this.db.close?.();}
}
export function supabaseRemote(client){return {
 async index(){const all=[];await Promise.all(KINDS.map(async kind=>{for(let from=0;;from+=1000){const {data,error}=await client.from(kind).select('id,version').order('id').range(from,from+999);if(error)throw error;all.push(...data.map(row=>({...row,kind})));if(data.length<1000)break;}}));return all;},
 async read(headers){const all=[];for(const kind of KINDS){const ids=headers.filter(row=>row.kind===kind).map(row=>row.id);for(let from=0;from<ids.length;from+=100){const {data,error}=await client.from(kind).select('id,data,version,updated_at').in('id',ids.slice(from,from+100));if(error)throw error;all.push(...data.map(row=>({...row,kind})));}}return all;},
 async apply(op){const {data,error}=await client.rpc('apply_sync_change',{p_kind:op.kind,p_id:op.id,p_expected_version:op.baseVersion,p_patch:op.patch,p_operation_id:op.opId});if(error)throw error;return data;}
};}
