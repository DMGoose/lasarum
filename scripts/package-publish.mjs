import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {root} from './publish-files.mjs';
import {checkPublish} from './check-publish.mjs';
const files=await checkPublish(),destination=path.resolve(root,'.publish',String(Date.now()));
if(!destination.startsWith(path.join(root,'.publish')+path.sep))throw new Error('Invalid publication directory.');
for(const file of files){const target=path.join(destination,file.name);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,file.content);}
console.log(`Prepared ${files.length} reviewed files in ${destination}`);
