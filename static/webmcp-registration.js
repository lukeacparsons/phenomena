import {defineTool,registerTools} from './webmcp-sdk.js';
import {createWebMCPTools} from './webmcp.js';

// Durable identities are independent of wire names and must not change on a rerun.
const stableKeys=Object.freeze({
  get_context:'adopted.get_context',
  search_screenings:'adopted.search_screenings',
  get_film:'adopted.get_film',
  get_screening:'adopted.get_screening',
  set_search:'adopted.set_search',
  show_screening:'adopted.show_screening'
});

function resultEnvelope(result){
  return {
    content:[{type:'text',text:JSON.stringify(result)}],
    structuredContent:result,
    isError:result?.ok===false
  };
}

// Keep the existing data-ready gate, atomic batch and page-lifetime cleanup.
// Definitions bind to the same page service once, not on each search or render.
export async function registerWebMCP(registry,service,{signal,onError=()=>{}}={}){
  if(typeof registry?.registerTool!=='function'||signal?.aborted)return null;
  const lifecycle=new AbortController();
  const abort=()=>lifecycle.abort();
  signal?.addEventListener('abort',abort,{once:true});
  let ready=false,registration;
  const cleanup=()=>{
    ready=false;
    abort();
    registration?.unregister();
    signal?.removeEventListener('abort',abort);
  };
  try{
    const tools=createWebMCPTools(service).map(tool=>defineTool({
      ...tool,
      name:tool.name,
      stableKey:stableKeys[tool.name],
      source:'merchant_authored',
      intent:tool.annotations.readOnlyHint?'answer':'act',
      async execute(...args){
        const result=ready&&!lifecycle.signal.aborted
          ?await tool.execute(...args)
          :{ok:false,error:{code:'not_ready',message:'The tools are not ready. Try again after page loading completes.'}};
        return resultEnvelope(result);
      }
    }));
    registration=registerTools(tools,{
      modelContext:registry,
      signal:lifecycle.signal,
      tracking:{
        builtWith:'webmcp-kit/connect-existing-tools@0.11.1',
        apiKey:"wmk_g4p82XLGKmD_hpVNSbd9PKgvI5vX3xigA4Id1VmHyEI" /* publishable key, safe to commit */,
        endpoint:"https://ingest.nekuda.ai/v1/collect"
      }
    });
    const results=await registration.ready;
    if(lifecycle.signal.aborted){cleanup();return null;}
    const failure=results.find(result=>result.state!=='registered');
    if(failure)throw failure.error||new Error('WebMCP tool registration did not complete.');
    ready=true;
    return cleanup;
  }catch(error){
    cleanup();
    onError(error);
    return null;
  }
}
