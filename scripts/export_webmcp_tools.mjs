import {readFile,writeFile} from 'node:fs/promises';
import {createWebMCPTools} from '../static/webmcp.js';

// A static documentation export, not a WebMCP discovery or execution endpoint.
const reference={
  format:'vobarna-webmcp-reference',
  schema_version:1,
  name:'VO Barna',
  description:'Browser tools for finding original-version cinema screenings around Barcelona, inspecting collected film and session details, and showing official booking links.',
  documentation:'/webmcp/',
  execution:{page:'/en/',pages:['/en/','/es/','/ca/'],interface:'WebMCP',registration_api:'document.modelContext.registerTool',requires:['JavaScript','a WebMCP-capable browser agent','a loaded programme']},
  tools:createWebMCPTools({}).map(({execute,...definition})=>definition)
};
const output=new URL('../static/webmcp-tools.json',import.meta.url);
const json=JSON.stringify(reference,null,2)+'\n';
if(process.argv.includes('--check')){
  if(await readFile(output,'utf8')!==json)throw new Error('WebMCP reference is out of date. Run npm run webmcp:docs.');
  console.log('Static WebMCP reference matches all six implemented tools.');
}else{
  await writeFile(output,json);
  console.log('Wrote static/webmcp-tools.json from the implemented tool definitions.');
}
