import {mkdir,writeFile,rename} from 'node:fs/promises';
import {dirname} from 'node:path';
export async function saveJSON(path,value){
  await mkdir(dirname(path),{recursive:true,mode:0o700});
  const tmp=path+'.'+process.pid+'.tmp';
  await writeFile(tmp,JSON.stringify(value)+'\n',{mode:0o600});await rename(tmp,path);
}
