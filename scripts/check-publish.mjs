import {publishFiles} from './publish-files.mjs';
export async function checkPublish(){
 const files=await publishFiles();
 for(const {name,content} of files){
   if(/(^|\/)(\.env(?!\.example)|\.cache|node_modules|dist|qa)(\/|$)/.test(name)||/\.(wav|mp3|jpg|png)$/i.test(name))throw new Error(`Private artifact in publication list: ${name}`);
   if(/sk-or-v1-[A-Za-z0-9_-]{20,}|sb_secret_[A-Za-z0-9_-]{20,}/.test(content))throw new Error(`Potential secret in ${name}`);
   if(/[A-Za-z0-9._%+-]+@(gmail|outlook|hotmail)\.com/i.test(content))throw new Error(`Personal email must not be published: ${name}`);
   for(const match of content.matchAll(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g)){try{if(JSON.parse(Buffer.from(match[0].split('.')[1],'base64url')).role==='service_role')throw new Error(`Service-role JWT in ${name}`);}catch(error){if(error.message.startsWith('Service-role'))throw error;}}
 }
 return files;
}
if(process.argv[1]?.endsWith('check-publish.mjs')){const files=await checkPublish();console.log(`Publication check passed: ${files.length} source/configuration files; no private artifacts.`);}
