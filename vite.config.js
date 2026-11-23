import {defineConfig,loadEnv} from 'vite';
import project from './public/project-config.json' with {type:'json'};
export default defineConfig(({mode,command})=>{
 const env={...loadEnv(mode,process.cwd(),''),...process.env};
 if(command==='build'&&(!(env.VITE_SUPABASE_URL||project.supabaseUrl)||!(env.VITE_SUPABASE_PUBLISHABLE_KEY||project.publishableKey)))throw new Error('Set the Supabase project URL and publishable key before building.');
 if(env.VITE_SUPABASE_PUBLISHABLE_KEY&&!env.VITE_SUPABASE_PUBLISHABLE_KEY.startsWith('sb_publishable_'))throw new Error('Use a Supabase publishable key, never a service/secret key.');
 return {root:'public',publicDir:false,envDir:process.cwd(),base:env.PAGES_BASE||'./',build:{outDir:'../dist',emptyOutDir:true},server:{proxy:{'/api':'http://127.0.0.1:4317'}}};
});
