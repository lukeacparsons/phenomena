import policy from '../data/provider-source-policy.json' with {type:'json'};

const MAX_BODY=16*1024*1024;
const encoder=new TextEncoder();

export function allowedSource(value){
  let url;try{url=new URL(value);}catch{return false;}
  if(url.protocol!=='https:'||url.username||url.password||url.port||url.hash)return false;
  const host=url.hostname,path=url.pathname;
  if(policy.booking_hosts.includes(host)){
    if(/^\/seats\/\d+\/$/.test(path))return !url.search;
    if(path!=='/'||url.searchParams.get('p')!=='tickets'||!/^\d+$/.test(url.searchParams.get('perfCode')||''))return false;
    return [...url.searchParams].every(([key,value])=>({p:/^tickets$/,perfCode:/^\d+$/,s:/^[A-Z0-9-]+$/,language:/^(?:esp|cat|eng|es|ca|en)$/i,theatre:/^\d+$/}[key]?.test(value)));
  }
  if(url.search)return false;
  if(policy.a1_hosts.includes(host))return ['/', '/api/get-events', '/api/get-theaters'].includes(path);
  if(host==='www.moobycinemas.com')return policy.mooby_paths.includes(path.replace(/\/$/,''));
  if(host==='cinesfilmax.com')return /^\/[a-z0-9][a-z0-9-]*\/?$/.test(path)&&!['/admin','/login','/logout','/checkout','/account','/wp-admin','/wp-login'].includes(path.replace(/\/$/,''));
  if(host==='www.institutfrancais.es')return path==='/barcelona/eventos/nuestros-eventos/'||/^\/barcelona\/evento\/[a-z0-9-]+\/$/.test(path);
  return false;
}

export async function readBounded(stream,limit){
  if(!stream)throw new Error('empty_body');
  const reader=stream.getReader(),chunks=[];let length=0;
  try{
    while(true){const {value,done}=await reader.read();if(done)break;
      length+=value.byteLength;if(length>limit){await reader.cancel();throw new Error('body_too_large');}chunks.push(value);}
  }finally{reader.releaseLock();}
  const bytes=new Uint8Array(length);let at=0;
  for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.byteLength;}
  return bytes;
}

async function authorized(request,secret){
  if(!secret)return false;
  const header=request.headers.get('Authorization')||'';
  if(header.length>256)return false;
  // Verify through WebCrypto instead of comparing secret strings in JS.
  const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
  const signature=await crypto.subtle.sign('HMAC',key,encoder.encode('Bearer '+secret));
  return crypto.subtle.verify('HMAC',key,signature,encoder.encode(header));
}

export async function readProgramme(request,env,fetcher=fetch){
  const fail=(message,status)=>Response.json({error:message},{status,headers:{'Cache-Control':'no-store'}});
  if(!await authorized(request,env.SOURCE_TOKEN))return fail('unauthorized',401);
  if(request.method!=='POST'||new URL(request.url).pathname!=='/programme')return fail('not_found',404);
  let target;
  try{const input=JSON.parse(new TextDecoder().decode(await readBounded(request.body,4096)));
    if(Object.keys(input).length!==1||typeof input.url!=='string'||!allowedSource(input.url))return fail('source_not_allowed',400);
    target=input.url;
  }catch{return fail('invalid_request',400);}
  const original=new URL(target);
  try{
    for(let redirect=0;redirect<3;redirect++){
      // No inbound headers, authorization, cookies or request bodies go upstream.
      const response=await fetcher(target,{method:'GET',redirect:'manual',signal:AbortSignal.timeout(25000),headers:{Accept:'application/json,text/html;q=0.9'}});
      if([301,302,303,307,308].includes(response.status)){
        const next=new URL(response.headers.get('Location')||'',target);
        await response.body?.cancel();
        if(next.origin!==original.origin||!allowedSource(next.href))return fail('upstream_redirect_rejected',502);
        target=next.href;continue;
      }
      if(response.status!==200){await response.body?.cancel();return fail('upstream_http_'+response.status,502);}
      const type=response.headers.get('Content-Type')||'';
      if(!/^(?:application\/json|text\/html)\b/i.test(type)){await response.body?.cancel();return fail('upstream_content_type',502);}
      const bytes=await readBounded(response.body,MAX_BODY);
      const sample=new TextDecoder().decode(bytes.subarray(0,4096));
      if(/\.well-known\/(?:sgcaptcha|captcha)\/|<title>Robot Challenge Screen<\/title>/.test(sample))return fail('upstream_browser_check',502);
      return new Response(bytes,{headers:{'Content-Type':type,'Cache-Control':'no-store','X-Source-Fetched-At':new Date().toISOString()}});
    }
    return fail('too_many_redirects',502);
  }catch(error){console.error(JSON.stringify({event:'provider_source_read_failed',host:original.hostname,type:error.name}));return fail('upstream_unavailable',502);}
}

export default {fetch(request,env){return readProgramme(request,env);}};
