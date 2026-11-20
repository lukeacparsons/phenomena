import {renderDateView,dateCacheControl} from './date-listings.mjs';
import {isProgrammePath,resolvePublicURL} from './public-routing.mjs';

async function assets(request,env,status,headers={}){
  const response=await env.ASSETS.fetch(request);
  const output=new Response(response.body,{status:status||response.status,headers:response.headers});
  for(const [key,value] of Object.entries(headers))output.headers.set(key,value);
  if((response.ok||response.status===304)&&/^\/preview-data\/images\/(?:[a-z0-9-]+-poster-)?[a-f0-9]{64}-\d+\.webp$/.test(new URL(request.url).pathname)){
    output.headers.set('Cache-Control','public, max-age=31536000, immutable');
  }
  output.headers.set('X-Content-Type-Options','nosniff');
  return output;
}

export default {
  async fetch(request,env){
    const url=new URL(request.url);
    if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405,headers:{Allow:'GET, HEAD'}});
    if(url.hostname==='www.vobarna.com'){
      url.hostname='vobarna.com';url.protocol='https:';
      return Response.redirect(url.href,301);
    }
    let decoded;
    try{decoded=decodeURIComponent(url.pathname);}catch{return new Response('Bad request',{status:400});}
    if(decoded.startsWith('/date-views/'))return new Response('Not found',{status:404,headers:{'X-Robots-Tag':'noindex','Cache-Control':'no-store'}});
    const pageLike=!/\.[a-z0-9]+$/i.test(url.pathname)||/\/(?:cinemas|index|webmcp)\.html$/i.test(url.pathname);
    if(!pageLike){
      const headers={};
      if(url.pathname.endsWith('.json'))headers['X-Robots-Tag']='noindex';
      if(['/programme.json','/availability.json'].includes(url.pathname))headers['Cache-Control']='public, max-age=60';
      return assets(request,env,undefined,headers);
    }
    try{
      const manifestResponse=await env.ASSETS.fetch(new Request(new URL('/routes.json',url)));
      if(!manifestResponse.ok)throw new Error('Publication routes missing');
      // This is our build-generated, size-validated static asset, not remote input.
      const routes=await manifestResponse.json();
      const screening=url.searchParams.get('screening');
      if(routes.screening_shards&&screening&&isProgrammePath(url.pathname)){
        const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(screening)));
        const shard=digest[0].toString(16).padStart(2,'0');
        const response=await env.ASSETS.fetch(new Request(new URL('/route-data/screenings/'+shard+'.json',url)));
        if(!response.ok)throw new Error('Screening redirects missing');
        routes.screenings=await response.json();
      }
      const now=new Date();
      const decision=resolvePublicURL(url.href,routes,now);
      if(decision.status===302)return new Response(null,{status:302,headers:{Location:new URL(decision.location,url).href,'Cache-Control':'no-store'}});
      if(decision.status===301)return Response.redirect(new URL(decision.location,url).href,301);
      if(decision.status===404)return assets(request,env,404,{'X-Robots-Tag':'noindex'});
      if(decision.dateView){
        const html=await renderDateView(decision.dateView,routes,async path=>{
          const response=await env.ASSETS.fetch(new Request(new URL(path,url)));
          if(!response.ok)throw new Error('Date publication missing');
          // These are build-generated assets capped at 4 MB by publication validation.
          return response.text();
        });
        return new Response(request.method==='HEAD'?null:html,{headers:{'Content-Type':'text/html; charset=utf-8',
          'Cache-Control':dateCacheControl(now),'X-Content-Type-Options':'nosniff',
          ...(decision.noindex?{'X-Robots-Tag':'noindex, follow'}:{})}});
      }
      return assets(new Request(new URL(decision.path,url),request),env,undefined,
        {'Cache-Control':'public, max-age=60',...(decision.noindex?{'X-Robots-Tag':'noindex, follow'}:{})});
    }catch(error){
      console.error(JSON.stringify({event:'publication_route_failure',message:error.message}));
      return new Response('The programme is temporarily unavailable.',{status:503,headers:{'Retry-After':'300'}});
    }
  }
};
