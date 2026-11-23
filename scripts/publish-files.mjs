import {readdir,readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export async function publishFiles(){
 const files=['package.json','package-lock.json','vite.config.js','server.mjs','import-url.mjs','README.md','.gitignore','.env.example'];
 async function walk(folder){for(const entry of await readdir(path.join(root,folder),{withFileTypes:true})){const relative=`${folder}/${entry.name}`;if(entry.isSymbolicLink())throw new Error(`Do not publish symlinks: ${relative}`);if(entry.isDirectory())await walk(relative);else files.push(relative);}}
 for(const folder of ['public','supabase','test','scripts','.github/workflows'])await walk(folder);
 files.push('docs/CLOUD-SETUP.md');
 return Promise.all(files.sort().map(async name=>({name,content:await readFile(path.join(root,name),'utf8')})));
}
