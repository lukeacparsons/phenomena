// Calendar views share build-generated HTML; no requests go to cinema providers.
export const dayPaths={
  today:{en:'/en/showtimes/today/',es:'/es/cartelera/hoy/',ca:'/ca/cartellera/avui/'},
  tomorrow:{en:'/en/showtimes/tomorrow/',es:'/es/cartelera/manana/',ca:'/ca/cartellera/dema/'}
};
const madrid=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'});
export const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&value.slice(0,4)!=='0000'
  &&Number.isFinite(Date.parse(value+'T12:00:00Z'))&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;
export function dateView(path,query,now=new Date()){
  for(const [kind,paths] of Object.entries(dayPaths))for(const [lang,route] of Object.entries(paths)){
    if(path!==route)continue;
    const day=new Date(madrid.format(now)+'T12:00:00Z');
    if(kind==='tomorrow')day.setUTCDate(day.getUTCDate()+1);
    return {lang,kind,date:day.toISOString().slice(0,10)};
  }
  const lang=/^\/(en|es|ca)\/$/.exec(path)?.[1],dates=query.getAll('date');
  return lang&&dates.length===1&&validDate(dates[0])?{lang,kind:'date',date:dates[0]}:null;
}
export function dateCacheControl(now=new Date()){
  // Cap the ordinary 60-second TTL at Madrid midnight, including both DST offsets.
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Madrid',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(now);
  const values=Object.fromEntries(parts.map(p=>[p.type,p.value]));
  const remaining=86400-Number(values.hour)*3600-Number(values.minute)*60-Number(values.second);
  return `public, max-age=${Math.min(60,remaining)}`;
}
export async function renderDateView(view,routes,read){
  const {lang,kind,date}=view;
  if(!['en','es','ca'].includes(lang)||!['today','tomorrow','date'].includes(kind)||!validDate(date))throw new Error('Invalid date view');
  const name=routes.date_views.dates.includes(date)?date:'empty';
  const [template,fragment]=await Promise.all([read(`/date-views/${lang}/${kind}.txt`),read(`/date-views/${lang}/${name}.txt`)]);
  if(template.length>4_000_000||fragment.length>4_000_000)throw new Error('Date view exceeds its size limit');
  if(!template.includes('__VOBARNA_DATE_LISTING__'))throw new Error('Invalid date template');
  // Replacements are callbacks so dollar signs in film titles remain literal.
  return template.replaceAll('__VOBARNA_DATE__',date).replace('__VOBARNA_DATE_LISTING__',()=>fragment);
}
