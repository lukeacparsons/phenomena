// Pure URL policy shared by the edge worker and its tests.
export const isProgrammePath=path=>/^\/(?:cinemas\.html|index\.html|(?:en|es|ca)(?:\/(?:index\.html)?)?)?$/i.test(path.replace(/\/{2,}/g,'/'));

export function resolvePublicURL(input, routes, now=new Date()){
  const url=new URL(input),lang=/^\/(en|es|ca)(?:\/|$)/i.exec(url.pathname)?.[1].toLowerCase()||'en';
  const query=url.searchParams;
  let path=url.pathname.replace(/\/{2,}/g,'/').replace(/\/index\.html$/i,'/').toLowerCase();
  if(path==='/'||path==='/index.html')path='/en/';
  if(path==='/webmcp.html')path='/webmcp/';
  if(path==='/cinemas.html'||(isProgrammePath(url.pathname)&&['film','screening','cinema'].some(key=>query.get(key)))){
    const film=query.get('film'),screening=query.get('screening'),cinema=query.get('cinema');
    if(screening){
      const target=routes.screenings?.[screening]?.[lang];
      if(!target)return {status:404};
      if(film&&routes.films[film]?.[lang]!==target.split('#')[0])return {status:404};
      return {status:308,location:target};
    }
    if(film)return routes.films[film]?.[lang]?{status:308,location:routes.films[film][lang]}:{status:404};
    if(cinema)return routes.cinemas[cinema]?.[lang]?{status:308,location:routes.cinemas[cinema][lang]}:{status:404};
    return {status:308,location:'/en/'+url.search};
  }
  if(!path.endsWith('/')&&!path.split('/').at(-1).includes('.'))path+='/';
  const todayLocale={'/en/showtimes/today/':'en','/es/cartelera/hoy/':'es','/ca/cartellera/avui/':'ca'}[path];
  if(todayLocale){
    const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
    return {status:302,location:`/${todayLocale}/?date=${date}`};
  }
  const target=routes.redirects[path]||path;
  if(!routes.pages.includes(target))return {status:404};
  // Filters and searches remain usable but do not create indexed combinations.
  const noindex=[...query.keys()].some(k=>!k.startsWith('utm_')&&!['gclid','fbclid'].includes(k));
  if(target!==url.pathname)return {status:308,location:target+url.search};
  return {status:200,path:target,noindex};
}
