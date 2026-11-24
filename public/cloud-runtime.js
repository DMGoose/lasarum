import project from './project-config.json' with {type:'json'};
import {SyncEngine,supabaseRemote} from './sync.js';
import {configureCloudAPI} from './cloud-api.js';
export const cloudEnabled=!!import.meta.env&&!import.meta.env.VITE_LOCAL_ONLY;
export class CloudRuntime{
 constructor({onSnapshot,onAccess,onStatus}){Object.assign(this,{onSnapshot,onAccess,onStatus});this.generation=0;}
 async start(){
   const {createClient}=await import('@supabase/supabase-js');
   this.url=import.meta.env?.VITE_SUPABASE_URL||project.supabaseUrl;this.key=import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY||project.publishableKey;
   this.client=createClient(this.url,this.key,{auth:{flowType:'pkce',persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});configureCloudAPI(this.client,this.url,this.key);
   this.client.auth.onAuthStateChange((_event,session)=>{setTimeout(()=>this.acceptSession(session),0);});
   const {data,error}=await this.client.auth.getSession();if(error)throw error;await this.acceptSession(data.session);
   this.online=()=>this.engine?.sync();this.focus=()=>{if(document.visibilityState==='visible')this.engine?.sync();};
   window.addEventListener('online',this.online);window.addEventListener('focus',this.online);document.addEventListener('visibilitychange',this.focus);
   this.poll=setInterval(()=>this.engine?.sync(),15000);
 }
 async acceptSession(session){
   if(this.user?.id===session?.user?.id&&this.engine){this.engine.sync();return;}
   const generation=++this.generation;
   await this.engine?.stop();this.engine=null;this.user=null;await this.client.removeAllChannels();this.onAccess(null);
   if(!session)return;
   try{
     const {data,error}=await this.client.from('app_members').select('user_id').eq('user_id',session.user.id).maybeSingle();
     if(generation!==this.generation)return;
     if(error)throw error;if(!data)throw new Error('This Google account is not approved for this private app.');
     this.user=session.user;
     let restoring=true;
     this.engine=new SyncEngine({account:this.user.id,remote:supabaseRemote(this.client),onSnapshot:snapshot=>{if(generation===this.generation)this.onSnapshot(snapshot,{preserveActive:!restoring});},onStatus:status=>{if(generation===this.generation)this.onStatus(status);}});
     await this.engine.start();if(generation!==this.generation)return;this.onAccess(this.user);
     this.channel=this.client.channel(`account-${this.user.id}`);
     for(const table of ['articles','vocabulary','reading_progress','user_settings'])this.channel.on('postgres_changes',{event:'*',schema:'public',table,filter:`owner_id=eq.${this.user.id}`},()=>{clearTimeout(this.refreshTimer);this.refreshTimer=setTimeout(()=>this.engine?.sync(),100);});
     this.channel.subscribe(status=>{if(status==='SUBSCRIBED')this.engine?.sync();});
     await this.engine.sync();restoring=false;
   }catch(error){if(generation===this.generation){this.user=null;this.onAccess(null,error.message);}}
 }
 async login(){const redirectTo=new URL(import.meta.env.BASE_URL||'./',location.href);redirectTo.search='';redirectTo.hash='';const {error}=await this.client.auth.signInWithOAuth({provider:'google',options:{redirectTo:redirectTo.href}});if(error)throw error;}
 async logout(){await this.engine?.serial;const {error}=await this.client.auth.signOut({scope:'local'});if(error)throw error;}
 async save(snapshot,before){if(!this.user||!this.engine)throw new Error('Sign in before saving cloud data.');await this.engine.save(snapshot,before);clearTimeout(this.saveTimer);this.saveTimer=setTimeout(()=>this.engine?.sync(),800);}
 async resolve(kind,id,choice){await this.engine.resolve(kind,id,choice);await this.engine.sync();}
}
