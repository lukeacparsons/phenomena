// Pure URL policy shared by the edge worker and its tests.
import {dayPaths,dateView,validDate} from './date-listings.mjs';
export const isProgrammePath=path=>/^\/(?:cinemas\.html|index\.html|(?:en|es|ca)(?:\/(?:index\.html)?)?)?$/i.test(path.replace(/\/{2,}/g,'/'))
  ||Object.values(dayPaths).some(paths=>Object.values(paths).includes(path.toLowerCase().replace(/\/index\.html$/,'/').replace(/\/?$/,'/')));

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
      return {status:301,location:target};
    }
    if(film)return routes.films[film]?.[lang]?{status:301,location:routes.films[film][lang]}:{status:404};
    if(cinema)return routes.cinemas[cinema]?.[lang]?{status:301,location:routes.cinemas[cinema][lang]}:{status:404};
    return {status:301,location:'/en/'+url.search};
  }
  if(!path.endsWith('/')&&!path.split('/').at(-1).includes('.'))path+='/';
  const target=routes.redirects[path]||path;
  if(!routes.pages.includes(target))return {status:404};
  // Filters and searches remain usable but do not create indexed combinations.
  const noindex=[...query.keys()].some(k=>!k.startsWith('utm_')&&!['gclid','fbclid'].includes(k));
  if(target!==url.pathname)return {status:301,location:target+url.search};
  if(isProgrammePath(target)&&query.has('date')&&(query.getAll('date').length!==1||!validDate(query.get('date'))))return {status:404};
  const view=routes.date_views?.version===1?dateView(target,query,now):null;
  // Extra filters belong to the normal shareable programme, not a Today heading.
  if(view&&view.kind!=='date'&&noindex)return {status:302,location:`/${view.lang}/?${query.has('date')?'':`date=${view.date}&`}${query.toString()}`};
  return {status:200,path:target,noindex,...(view?{dateView:view}:{})};
}
