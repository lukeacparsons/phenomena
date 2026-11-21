// Read-only, loopback preview of the combined release. Never deploys or collects.
import {publicServer} from '../src/vobarna-server.mjs';
const server=publicServer();
server.listen(Number(process.env.PORT||8791),'127.0.0.1',()=>{
  console.log(JSON.stringify({event:'search_preview_ready',url:'http://127.0.0.1:'+server.address().port+'/en/'}));
  void server.warmSearch().catch(()=>{});
});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>process.exit(0)));
