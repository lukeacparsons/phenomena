// Portable origin for the static publication. Collection never runs in requests.
import {createServer} from 'node:http';
import {createReadStream} from 'node:fs';
import {readFile, realpath, stat} from 'node:fs/promises';
import {resolve, extname, sep} from 'node:path';
import {createHash} from 'node:crypto';
import {createGzip} from 'node:zlib';
import {pipeline} from 'node:stream/promises';
import {Readable} from 'node:stream';
import {renderDateView,dateCacheControl} from './date-listings.mjs';
import {pathToFileURL} from 'node:url';
import {isProgrammePath, resolvePublicURL} from './public-routing.mjs';
import {createSmartSearch} from './smart-search.mjs';

const types={'.html':'text/html; charset=utf-8','.json':'application/json; charset=utf-8',
  '.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8',
  '.svg':'image/svg+xml','.xml':'application/xml; charset=utf-8','.txt':'text/plain; charset=utf-8',
  '.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.ico':'image/x-icon',
  '.woff2':'font/woff2','.ttf':'font/ttf'};

export function publicServer({publication=process.env.PUBLICATION_ROOT||'.site', origin=process.env.PUBLIC_ORIGIN||'https://vobarna.com', indexNowKey=process.env.INDEXNOW_KEY,smartSearchOptions={},now=()=>new Date()}={}) {
  let active;
  let catalogue;
  const canonical=new URL(origin);
  async function release() {
    const root=await realpath(resolve(publication,'current/public'));
    if(active?.root!==root){
      const routes=JSON.parse(await readFile(resolve(root,'routes.json'),'utf8'));
      if(routes.origin!==canonical.origin||!Array.isArray(routes.pages)||!routes.pages.includes('/en/')||!routes.films||!routes.cinemas||!routes.redirects)
        throw new Error('Invalid publication');
      await stat(resolve(root,'en/index.html'));
      active={root,routes};
    }
    return active;
  }
  const smartSearch=createSmartSearch({cacheDirectory:resolve(publication,'search-cache'),getProgramme:async()=>{
    const current=await release();
    if(catalogue?.root!==current.root){
      const programme=JSON.parse(await readFile(resolve(current.root,'programme.json'),'utf8'));
      if(!Array.isArray(programme.films)||!Array.isArray(programme.cinemas))throw new Error('Invalid catalogue');
      catalogue={root:current.root,programme};
    }
    return catalogue.programme;
  },...smartSearchOptions});
  const server=createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
    function reply(status,body,headers={}){
      res.writeHead(status,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store',...headers});
      res.end(req.method==='HEAD'?undefined:body);
    }
    try {
      // Never trust forwarded hosts for redirect targets. Bunny passes a fixed origin Host.
      const url=new URL(req.url,canonical);
      if(!req.url.startsWith('/')||req.url.startsWith('//'))return reply(400,'Bad request');
      if(url.pathname==='/api/search'){
        const headers={'Content-Type':'application/json; charset=utf-8','X-Robots-Tag':'noindex'};
        if(req.method!=='POST')return reply(405,JSON.stringify({error:'method_not_allowed'}),{...headers,Allow:'POST'});
        if(req.headers.origin&&req.headers.origin!==canonical.origin&&req.headers.origin!=='http://'+req.headers.host)return reply(403,JSON.stringify({error:'origin_not_allowed'}),headers);
        if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))return reply(415,JSON.stringify({error:'invalid_content_type'}),headers);
        try{
          const body=await new Promise((done,reject)=>{
            let bytes=0,chunks=[];
            req.on('data',chunk=>{bytes+=chunk.length;if(bytes>4096){chunks=[];reject(Object.assign(new Error('Request too large'),{code:'invalid_input'}));}else chunks.push(chunk);});
            req.on('end',()=>{try{done(JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch{reject(Object.assign(new Error('Invalid JSON'),{code:'invalid_input'}));}});
            req.on('error',reject);
          });
          const result=await smartSearch.search(body,{client:req.socket.remoteAddress});
          return reply(200,JSON.stringify(result),headers);
        }catch(error){
          const code=['invalid_input','rate_limited'].includes(error.code)?error.code:'search_unavailable';
          return reply(code==='invalid_input'?400:code==='rate_limited'?429:503,JSON.stringify({error:code}),headers);
        }
      }
      if(!['GET','HEAD'].includes(req.method))return reply(405,'Method not allowed',{Allow:'GET, HEAD'});
      if(req.headers.host?.split(':')[0]==='www.'+canonical.hostname)
        return reply(301,'',{'Location':canonical.origin+url.pathname+url.search});
      if(/^[A-Za-z0-9-]{8,128}$/.test(indexNowKey||'')&&url.pathname===`/${indexNowKey}.txt`)
        return reply(200,indexNowKey,{'X-Robots-Tag':'noindex','Cache-Control':'public, max-age=60'});
      const current=await release();
      if(url.pathname==='/healthz')return reply(200,JSON.stringify({ok:true,release:current.root.split(sep).at(-2),commit:process.env.SOURCE_COMMIT||null}),{'Content-Type':'application/json','X-Robots-Tag':'noindex'});
      const requestedAt=now();
      let status=200, path=url.pathname;
      if(path.startsWith('/date-views/'))return reply(404,'Not found',{'X-Robots-Tag':'noindex'});
      const pageLike=!/\.[a-z0-9]+$/i.test(path)||/\/(?:cinemas|index|webmcp)\.html$/i.test(path);
      if(pageLike){
        let routes=current.routes;
        const screening=url.searchParams.get('screening');
        if(routes.screening_shards&&screening&&isProgrammePath(path)){
          const shard=createHash('sha256').update(screening).digest('hex').slice(0,2);
          routes={...routes,screenings:JSON.parse(await readFile(resolve(current.root,'route-data/screenings',shard+'.json'),'utf8'))};
        }
        const decision=resolvePublicURL(url.href,routes,requestedAt);
        if(decision.status===302||decision.status===301)return reply(decision.status,'',{'Location':decision.location,'Cache-Control':decision.status===302?'no-store':'public, max-age=60'});
        if(decision.dateView){
          const html=await renderDateView(decision.dateView,routes,p=>readFile(resolve(current.root,'.'+p),'utf8'));
          const etag='W/"'+createHash('sha256').update(html).digest('hex')+'"';
          res.setHeader('Content-Type','text/html; charset=utf-8');
          res.setHeader('Cache-Control',dateCacheControl(requestedAt));
          res.setHeader('Vary','Accept-Encoding');
          res.setHeader('ETag',etag);
          if(decision.noindex)res.setHeader('X-Robots-Tag','noindex, follow');
          if(String(req.headers['if-none-match']||'').split(',').map(x=>x.trim()).includes(etag)){res.writeHead(304);return res.end();}
          const compressed=String(req.headers['accept-encoding']||'').split(',').some(part=>/^gzip(?:\s*;\s*q=(?!0(?:\.0*)?$)[0-9.]+)?$/i.test(part.trim()));
          if(compressed)res.setHeader('Content-Encoding','gzip');
          else res.setHeader('Content-Length',Buffer.byteLength(html));
          res.writeHead(200);
          if(req.method==='HEAD')return res.end();
          if(compressed)await pipeline(Readable.from([html]),createGzip({level:4}),res);
          else res.end(html);
          return;
        }
        if(decision.status===404){status=404;path='/404.html';}
        else {path=decision.path+'index.html';if(decision.noindex)res.setHeader('X-Robots-Tag','noindex, follow');}
      } else if(path.endsWith('.html')) {status=404;path='/404.html';}
      const decoded=decodeURIComponent(path);
      if(decoded.includes('\0')||decoded.includes('\\'))return reply(400,'Bad request');
      if(decoded.startsWith('/date-views/'))return reply(404,'Not found',{'X-Robots-Tag':'noindex'});
      let file=resolve(current.root,'.'+decoded),info;
      if(!file.startsWith(current.root+sep))return reply(404,'Not found',{'X-Robots-Tag':'noindex'});
      try{
        file=await realpath(file);
        if(!file.startsWith(current.root+sep))return reply(404,'Not found',{'X-Robots-Tag':'noindex'});
        info=await stat(file);
        if(!info.isFile())throw Object.assign(new Error('Not a file'),{code:'ENOENT'});
      }catch(error){
        if(!['ENOENT','ENOTDIR'].includes(error.code))throw error;
        status=404;file=resolve(current.root,'404.html');info=await stat(file);
      }
      const extension=extname(file),type=types[extension]||'application/octet-stream';
      const compressed=info.size>=1024&&/^(text\/|application\/(json|xml)|image\/svg)/.test(type)
        &&String(req.headers['accept-encoding']||'').split(',').some(part=>/^gzip(?:\s*;\s*q=(?!0(?:\.0*)?$)[0-9.]+)?$/i.test(part.trim()));
      const etag='W/"'+info.size.toString(16)+'-'+info.mtimeMs.toString(16)+'"';
      const immutable=status===200&&/^\/preview-data\/images\/(?:[a-z0-9-]+-poster-)?[a-f0-9]{64}-\d+\.webp$/.test(path);
      res.setHeader('Content-Type',type);
      res.setHeader('Cache-Control',status===404?'no-store':immutable?'public, max-age=31536000, immutable':'public, max-age=60');
      res.setHeader('Vary','Accept-Encoding');
      res.setHeader('ETag',etag);
      if(status===404||extension==='.json')res.setHeader('X-Robots-Tag','noindex');
      if(status===200&&String(req.headers['if-none-match']||'').split(',').map(x=>x.trim()).includes(etag)){
        res.writeHead(304);return res.end();
      }
      if(compressed)res.setHeader('Content-Encoding','gzip');
      else res.setHeader('Content-Length',info.size);
      res.writeHead(status);
      if(req.method==='HEAD')return res.end();
      if(compressed)await pipeline(createReadStream(file),createGzip({level:4}),res);
      else await pipeline(createReadStream(file),res);
    }catch(error){
      if(res.headersSent){res.destroy();return;}
      if(error instanceof URIError)return reply(400,'Bad request');
      console.error(JSON.stringify({event:'publication_request_failed',code:error.code||error.name}));
      reply(503,'The programme is temporarily unavailable.',{'Retry-After':'300','X-Robots-Tag':'noindex'});
    }
  });
  server.requestTimeout=30_000;
  server.headersTimeout=15_000;
  server.keepAliveTimeout=5_000;
  server.warmSearch=options=>smartSearch.warm(options);
  return server;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const server=publicServer();
  server.listen(Number(process.env.PORT||8787),'0.0.0.0',()=>console.log(JSON.stringify({event:'origin_started'})));
  const warm=options=>server.warmSearch(options).catch(()=>console.error(JSON.stringify({event:'search_warmup_failed'})));
  void warm({interpreter:true});const searchRefresh=setInterval(()=>void warm(),300000);searchRefresh.unref();
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{server.close(()=>process.exit(0));setTimeout(()=>process.exit(1),10_000).unref();});
}
