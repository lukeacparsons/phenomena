// Private loopback companion for the Python development server. It shares the
// production endpoint, interpreter and embeddings rather than a second parser.
import {readFile,stat,realpath} from 'node:fs/promises';
import {resolve} from 'node:path';
import {publicServer} from './vobarna-server.mjs';

let catalogue;
const smartSearchOptions={getProgramme:async()=>{
  const path=await realpath(process.env.SEARCH_PROGRAMME_PATH||resolve(process.env.PUBLICATION_ROOT||'.site','current/public/programme.json'));
  const info=await stat(path),version=path+':'+info.mtimeMs+':'+info.size;
  if(catalogue?.version!==version)catalogue={version,programme:JSON.parse(await readFile(path,'utf8'))};
  return catalogue.programme;
}};
const server=publicServer({smartSearchOptions});
server.listen(0,'127.0.0.1',()=>{
  console.log(JSON.stringify({event:'preview_search_ready',port:server.address().port,enabled:Boolean(process.env.OPENAI_API_KEY)}));
  void server.warmSearch().catch(()=>console.error('Preview search cache unavailable; local filters remain available.'));
});
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{server.close(()=>process.exit(0));setTimeout(()=>process.exit(1),5000).unref();});
