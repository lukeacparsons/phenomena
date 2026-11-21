import {parseDateQuery} from './search-dates.js';
import {distanceKm} from './location-search.js';
import {parseLanguages,screeningAudio} from './screening-language.js';

// The interpreter describes requests. Only sourced catalogue data and the
// visitor's explicit choices can satisfy these constraints.
const fold=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const esc=v=>v.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const condition=(field,op,value)=>({field,op,value:String(value)});
export const OUTING_NUMERIC={finish_time:1439,starts_within:10080,distance_km:500,price_eur:10000,seats_available:100000,seats_together:100,wheelchair_seats:1000,occupancy_percent:100,age_max:21};
export const OUTING_BOOLEAN=['has_subtitles','booking_open','adaptation','sequel','remake','silent'];
export const OUTING_FIELDS=[...Object.keys(OUTING_NUMERIC),...OUTING_BOOLEAN,'adaptation_kind','audio_only','director','actor','writer','composer','cinematographer','film_id','keyword','event','edition','award','nomination','content_warning','venue_feature'];
export const OUTING_SORTS=['distance','price','duration','duration_desc','seats','finish'];
export const outingDefaults=()=>({alternatives:[],preferences:[],notices:[],scope:'upcoming',venue_query:'',itinerary:null});
const words={one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,un:1,una:1,uno:1,dos:2,dues:2,tres:3,cuatro:4,quatre:4,cinco:5,cinc:5,seis:6,sis:6,siete:7,set:7,ocho:8,vuit:8};
const count=v=>words[v]||Number(v.replace(',','.'));
const numbers='(\\d+(?:[.,]\\d+)?|'+Object.keys(words).join('|')+')';
const filler=/\b(?:show me|find me|looking for|i want|i d like|something|anything|that|which|is|are|a|an|the|films?|movies?|screenings?|showings?|cinemas?|with|and|at|in|on|but|please|quiero|busco|peliculas?|pelis|sesiones?|cines?|que|con|y|en|a|las?|los?|vull|busca|pel licules|sessions?|cinemes?|amb|i|al|les|els)\b/g;
const tidy=v=>v.replace(filler,' ').replace(/\s+/g,' ').trim();
export function preservesQueryDates(text){return /\b(?:or|o|yesterday|ayer|ahir|last week|semana pasada|setmana passada|previous screenings|past screenings)\b/i.test(fold(text));}
const clock=(h,m,period)=>{let n=Number(h);if(period)n=n%12+(period==='pm'?12:0);return n<24&&Number(m||0)<60?n*60+Number(m||0):null;};
const clockPattern='(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm)?';
const madridClock=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Madrid',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
const dateConditions=range=>range?(range.start===range.end?[condition('date','eq',range.start)]:[condition('date','gte',range.start),condition('date','lte',range.end)]):[];
const findReference=(text,programme)=>(programme?.films||[]).filter(f=>[f.title,f.original_title,f.english_title,...(f.titles||[])].some(t=>t&&fold(t)===fold(text)));

export function parseOuting(text,options,parseBasic){
  if(options.exactTitle||!text.trim())return parseBasic(text,options);
  let rest=String(text).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[’'·]/g,' ');
  const extra=outingDefaults(),conditions=[];
  let changed=false;
  const add=(field,op,value)=>{conditions.push(condition(field,op,value));changed=true;};
  const consume=(regex,fn)=>{rest=rest.replace(regex,(...m)=>{changed=true;fn(...m);return ' ';});};
  // Keep title/person words away from generic facilities and time parsing.
  const protectedText=[];
  for(const name of options.protectedNames||[]){
    if(name.split(' ').length<2)continue;
    rest=rest.replace(new RegExp('\\b'+esc(fold(name))+'\\b','g'),match=>{const token='zzouting'+protectedText.length+'zz';protectedText.push([token,match]);return token;});
  }
  const restore=v=>protectedText.reduce((value,[token,name])=>value.replaceAll(token,name),v);

  consume(new RegExp('\\b(?:finishes?|ends?|ending|termina|termine|acaba|acabe|acabi|acabin)\\s+(before|by|antes de|abans de)\\s+(?:las?\\s+|les\\s+)?'+clockPattern,'g'),(_,op,h,m,p)=>{
    const value=clock(h,m,p);if(value===null)extra.notices.push('invalid_time');else add('finish_time',op==='by'?'lte':'lt',value);
  });
  consume(new RegExp('\\b(?:starts?|starting|empieza|empiece|comenca|comenci)?\\s*(?:in the next|within the next|within|en los proximos|en els propers|dentro de)\\s+'+numbers+'\\s*(minutes?|mins?|minutos?|minuts?)\\b','g'),(_,n)=>add('starts_within','lte',count(n)));
  consume(new RegExp('\\b(?:i m free|available|free|libre|disponible|lliure)\\s+(?:between|entre)\\s+'+clockPattern+'\\s*(?:and|y|i|to|a)\\s*'+clockPattern,'g'),(_,h,m,p,h2,m2,p2)=>{
    const start=clock(h,m,p),end=clock(h2,m2,p2);if(start===null||end===null)extra.notices.push('invalid_time');else{add('start_time','gte',start);add('finish_time','lte',end);}
  });
  consume(new RegExp('\\b(?:within|under|less than|a menos de|a menys de|en un radio de)\\s+'+numbers+'\\s*(km|kilomet(?:er|re|ro)s?|m|met(?:er|re|ro)s?)\\b','g'),(_,n,u)=>add('distance_km','lte',count(n)/(u==='m'||u.startsWith('met')?1000:1)));
  consume(new RegExp('\\b(?:under|below|less than|menos de|menys de)\\s*(?:€\\s*)?'+numbers+'\\s*(?:€|euros?)','g'),(_,n)=>add('price_eur','lt',count(n)));
  consume(new RegExp('\\b(?:under|below|less than|menos de|menys de)\\s*€\\s*'+numbers+'\\b','g'),(_,n)=>add('price_eur','lt',count(n)));
  consume(new RegExp('€\\s*'+numbers+'\\s*(?:or less|maximum|maximo|maxim)\\b','g'),(_,n)=>add('price_eur','lte',count(n)));
  consume(/\b(?:free (?:screenings|films|movies|entry|admission)|gratis|gratuitas?|gratuites?|entrada (?:libre|lliure))\b/g,()=>add('price_eur','eq',0));
  consume(/\b(?:not sold out|available seats|seats available|con entradas disponibles|amb entrades disponibles|no agotadas|no exhaurides)\b/g,()=>add('seats_available','gt',0));
  consume(new RegExp('\\b'+numbers+'\\s+(?:seats|places|asientos|entradas|seients|entrades)\\s+(?:together|adjacent|juntos|junt[ae]s|consecutivos|consecutius)\\b','g'),(_,n)=>add('seats_together','gte',count(n)));
  consume(new RegExp('\\b(?:at least|minimum|al menos|com a minim)\\s+'+numbers+'\\s+(?:seats|places|asientos|entradas|seients|entrades)\\b','g'),(_,n)=>add('seats_available','gte',count(n)));
  consume(/\b(?:fairly empty|quiet screening|not crowded|poco concurrida|poc concorreguda)\b/g,()=>add('occupancy_percent','lte',35));
  consume(/\b(?:booking open|tickets on sale|entradas a la venta|entrades a la venda)\b/g,()=>add('booking_open','eq',true));
  consume(/\b(?:no|without|sin|sense)\s+(?:subtitles|subtitulos|subtitols)\b/g,()=>add('has_subtitles','eq',false));
  consume(/\b(?:silent films?|silent movies?|cine mudo|cinema mut)\b/g,()=>add('silent','eq',true));
  consume(/\b(?:no sequels|not a sequel|sin secuelas|sense sequeles)\b/g,()=>add('sequel','eq',false));
  consume(/\b(?:the original not the remake|original not (?:a )?remake|no remakes|not a remake|sin remakes|sense remakes)\b/g,()=>add('remake','eq',false));
  consume(/\b(?:adaptations? of (?:novels|books)|based on (?:a )?(?:book|novel)|adaptaciones? de novelas|adaptacions? de novel les)\b/g,()=>add('adaptation_kind','eq','book'));
  consume(new RegExp('\\b(?:suitable for|appropriate for|for a|para (?:un nino de|una nina de)|per a (?:un nen de|una nena de))\\s+(?:a\\s+)?'+numbers+'(?:[ -]year[ -]olds?|\\s*(?:years? old|anos|anys))?\\b','g'),(_,n)=>add('age_max','lte',count(n)));
  for(const [pattern,field,value] of [
    [/\b(?:no jump scares|without jump scares|sin sustos|sense ensurts)\b/g,'content_warning','jump scares'],
    [/\b(?:no animal deaths|without animal deaths|sin muerte de animales|sense morts d animals)\b/g,'content_warning','animal death'],
    [/\b(?:no sexual violence|without sexual violence|sin violencia sexual|sense violencia sexual)\b/g,'content_warning','sexual violence']
  ])consume(pattern,()=>add(field,'ne',value));
  for(const [pattern,value] of [
    [/\b(?:director q[\s&]*a|q[\s&]*a|q and a|coloquio|col loqui)\b/g,'q&a'],
    [/\b(?:live musical accompaniment|live music|musica en directo|musica en directe)\b/g,'live music'],
    [/\b(?:relaxed screenings?|sesion relajada|sessio relaxada)\b/g,'relaxed'],
    [/\b(?:audio description|audio described|audiodescripcion|audiodescripcio)\b/g,'audio description']
  ])consume(pattern,()=>add('event','eq',value));
  for(const [pattern,value] of [[/\b(?:director s cut|montaje del director|muntatge del director)\b/g,'director cut'],[/\b(?:restored(?: version)?|restaurad[ao]|restaurad[ae])\b/g,'restored'],[/\b(?:double bill|programa doble|doble programa)\b/g,'double bill']])consume(pattern,()=>add('edition','eq',value));
  consume(/\b(?:palme d or winners?|ganadoras? de la palma de oro|guanyadores? de la palma d or)\b/g,()=>add('award','eq',"Palme d'Or"));
  consume(/\b(?:oscar nominated|academy award nominated|nominadas? al oscar|nominades? a l oscar)\b/g,()=>add('nomination','eq','Academy Award'));
  consume(/\b(?:won best cinematography|best cinematography winners?)\b/g,()=>add('award','eq','Best Cinematography'));
  consume(/\b(?:step free|wheelchair accessible|acceso sin escalones|acces sense escales)\b/g,()=>add('venue_feature','eq','step-free screening room'));
  consume(/\b(?:with recliners|con butacas reclinables|amb butaques reclinables)\b/g,()=>add('venue_feature','eq','recliners'));
  consume(/\b(?:near a metro station|cerca del metro|a prop del metro)\b/g,()=>add('venue_feature','eq','near metro'));
  // Routing data is not a straight-line distance estimate.
  consume(new RegExp('\\b'+numbers+'\\s*(?:minutes?|minutos?|minuts?)\\s+(?:on foot|walking|by car|by metro|a pie|caminando|a peu|en coche|en cotxe)\\b','g'),()=>extra.notices.push('travel_time'));
  consume(/\b(?:when does booking open|when do tickets go on sale|cuando (?:abre la venta|salen las entradas)|quan surten les entrades)\b/g,()=>extra.venue_query='booking');
  consume(/\b(?:is (?:this|it) coming back|coming back|returning screenings|volveran a proyectar|tornaran a projectar)\b/g,()=>{extra.scope='catalogue';extra.notices.push('future_programme');});
  consume(/\b(?:yesterday|ayer|ahir)\b/g,()=>{extra.scope='past';const day=new Date(options.today+'T12:00:00Z');day.setUTCDate(day.getUTCDate()-1);add('date','eq',day.toISOString().slice(0,10));});
  consume(/\b(?:last week|semana pasada|setmana passada)\b/g,()=>{extra.scope='past';const day=new Date(options.today+'T12:00:00Z'),weekday=day.getUTCDay();day.setUTCDate(day.getUTCDate()-((weekday+6)%7)-7);add('date','gte',day.toISOString().slice(0,10));day.setUTCDate(day.getUTCDate()+6);add('date','lte',day.toISOString().slice(0,10));});
  consume(/\b(?:past screenings|previous screenings|screening history|sesiones anteriores|sessions anteriors)\b/g,()=>extra.scope='past');
  if(extra.scope==='past')consume(/\b(?:what played|what was showing|what was on|que proyectaron|que se proyecto|que es va projectar)\b/g,()=>{});
  consume(new RegExp('\\b'+numbers+'\\s+(?:films|movies|peliculas|pel licules)\\s*(?=(?:on|this|with|without|el|con|amb|sense|sunday|saturday|friday|domingo|diumenge|sabado|dissabte|divendres|viernes|$))','g'),(_,n)=>{extra.itinerary={count:Math.min(3,Math.max(2,count(n))),min_gap:30,max_gap:180,same_cinema:true};});
  if(extra.itinerary){
    consume(/\b(?:with a dinner break|con una pausa para cenar|amb una pausa per sopar)\b/g,()=>extra.itinerary.min_gap=90);
    consume(/\b(?:without changing cinemas|same cinema|sin cambiar de cine|sense canviar de cinema)\b/g,()=>{});
    extra.notices.push('itinerary_estimate');
  }
  consume(/\b(?:cheapest|lowest price|mas baratas?|mes barates?)\b/g,()=>extra.sort='price');
  consume(/\b(?:longest(?:\s+(?:films?|movies?|runtime))?(?:\s+first)?|long\s+(?:films?|movies?|runtime)\s+first|(?:peliculas?\s+)?mas largas?(?:\s+primero)?|(?:pel licules\s+)?mes llarg(?:a|ues)(?:\s+primer)?)\b/g,()=>extra.sort='duration_desc');
  consume(/\b(?:shortest(?:\s+(?:films?|movies?|runtime))?(?:\s+first)?|short\s+(?:films?|movies?|runtime)\s+first|(?:peliculas?\s+)?mas cortas?(?:\s+primero)?|(?:pel licules\s+)?mes curt(?:a|es)(?:\s+primer)?)\b/g,()=>extra.sort='duration');
  consume(/\b(?:most seats|mas asientos|mes seients)\b/g,()=>extra.sort='seats');
  consume(/\b(?:earliest finish|finishes earliest)\b/g,()=>extra.sort='finish');
  // Venue questions return sourced passages, never convert broad building
  // claims into a guarantee about the selected auditorium.
  const venueQuestion=/\b(?:can i bring|which cinemas|does .* have|parking at|parking near|how (?:do i|to) get|puedo llevar|que cines|aparcamiento|puc portar|quins cinemes|aparcament)\b/.test(fold(text));
  if(venueQuestion){
    extra.venue_query=/\b(?:backpack|bag|food|water|luggage|mochila|comida|motxilla|menjar)\b/.test(fold(text))?'belongings':/\b(?:parking|aparcamiento|aparcament|metro|directions|get)\b/.test(fold(text))?'transport':/\b(?:recliner|recliners|seat|seats|butacas|butaques)\b/.test(fold(text))?'seating':'accessibility';
    rest='';conditions.length=0;changed=true;
  }

  rest=restore(rest);
  // A relation resolves only against identified catalogue films. Ambiguous
  // remakes need a year; absent references are not invented by the model.
  const relation=/\b(?:other films by the director of|same director as|del director de|del mateix director que)\s+(.+)$/i.exec(rest);
  if(relation){
    const refs=findReference(relation[1],options.programme);
    if(refs.length===1&&refs[0].details?.directors?.length){add('director','in',refs[0].details.directors.join('|'));add('film_id','ne',refs[0].id);}
    else extra.notices.push(refs.length>1?'ambiguous_reference':'unknown_reference');
    rest=rest.slice(0,relation.index);changed=true;
  }
  // Soft alternatives are kept separate from mandatory conditions.
  const preference=/\b(?:prefer(?:red)?|preferably|prefiero|preferiblement|preferentment)\s+(.+?)(?:,?\s+(?:but|pero|pero|however)\s+(.+?)(?:\s+(?:is fine|is acceptable|acceptable|esta bien|tambien sirve|tambe va be)))?$/.exec(rest)
    || /^(.+?)\s+preferred,?\s+(.+?)\s+(?:acceptable|is fine)$/.exec(rest);
  const languageClause=v=>v.trim().replace(/^(english|spanish|catalan|french|japanese|ingles|castellano|catalan|frances|angl[eè]s|catala|frances)(?:\s+audio)?$/i,'in $1');
  if(preference){
    const preferred=parseBasic(languageClause(preference[1]),options),fallback=preference[2]?parseBasic(languageClause(preference[2]),options):null;
    if(!tidy(preferred.text)&&preferred.conditions.length&&(!fallback||(!tidy(fallback.text)&&fallback.conditions.length))){
      extra.preferences.push({conditions:preferred.conditions,weight:1});
      if(fallback)extra.alternatives.push(preferred.conditions,fallback.conditions);
      rest=rest.slice(0,preference.index);changed=true;
    }
  }
  // Named credits and explicit title exclusions keep their role/identity.
  for(const [field,key,prefix] of [['director','directors','directed by|dirigidas? por|dirigides? per'],['actor','cast','starring|with actor|protagonizada por'],['writer','writers','written by|escritas? por'],['composer','composers','music by|score by|musica de'],['cinematographer','cinematographers','cinematography by|fotografia de']]){
    if(!new RegExp('\\b(?:'+prefix+')\\b').test(rest))continue;
    for(const name of new Set((options.programme?.films||[]).flatMap(f=>f.details?.[key]||[])))consume(new RegExp('\\b(?:'+prefix+')\\s+'+esc(fold(name))+'\\b','g'),()=>add(field,'eq',name));
  }
  for(const film of /\b(?:not|exclude|except|sin|sense|tt\d{7,10})\b/.test(rest)?options.programme?.films||[]:[]){
    for(const title of [film.title,film.original_title,film.english_title].filter(Boolean))consume(new RegExp('\\b(?:not|exclude|except|sin|sense)\\s+'+esc(fold(title))+'(?=$|[ ,;])','g'),()=>add('film_id','ne',film.id));
    if(film.imdb_id&&rest.includes(film.imdb_id)){add('film_id','eq',film.id);rest=rest.replace(/https?:\/\/\S+/g,'').replace(film.imdb_id,'');}
  }
  for(const [label,canonical] of [['english','English'],['spanish','Spanish'],['french','French'],['catalan','Catalan'],['ingles','English'],['anglès','English']])consume(new RegExp('\\b'+esc(fold(label))+'\\s+(?:audio only|only|solamente|nomes)\\b','g'),()=>add('audio_only','eq',canonical));

  const alternatives=rest.split(/\s+(?:or|o)\s+/);
  if(alternatives.length>1&&alternatives.length<=6){
    const groups=alternatives.map(branch=>{
      const date=parseDateQuery(branch,options.today),p=parseOuting(languageClause(date.text),{...options,protectedNames:[]},parseBasic);
      if(p.unsupported.length||p.notices?.length||p.alternatives?.length||p.preferences?.length)return null;
      const text=tidy(p.text);
      if(text&&!findReference(text,options.programme).length&&!(options.programme?.films||[]).some(f=>['directors','cast','writers','composers'].some(key=>(f.details?.[key]||[]).some(name=>fold(name)===fold(text)))))return null;
      return [...p.conditions,...dateConditions(date.range),...(text?[condition('keyword','eq',text)]:[])];
    });
    if(groups.every(g=>g?.length)){extra.alternatives.push(...groups);rest='';changed=true;}
  }
  const parsed=parseBasic(changed?tidy(rest):text,options);
  if(!changed&&!extra.alternatives.length&&!extra.preferences.length)return parsed;
  if(conditions.some(c=>['seats_available','seats_together','occupancy_percent','wheelchair_seats','booking_open'].includes(c.field)))extra.notices.push('seat_freshness');
  return {...parsed,...extra,sort:extra.sort||parsed.sort,conditions:[...conditions,...parsed.conditions]};
}

const compare=(a,op,b)=>({eq:a===b,ne:a!==b,gt:a>b,gte:a>=b,lt:a<b,lte:a<=b}[op]??false);
const numeric=(value,c)=>typeof value==='number'&&Number.isFinite(value)&&compare(value,c.op,Number(c.value));
const textMatches=(values,c)=>values.length>0&&(c.op==='ne'?c.value.split('|').every(w=>!values.some(v=>fold(v)===fold(w))):c.value.split('|').some(w=>values.some(v=>fold(v)===fold(w))));
const sourceOK=v=>typeof v==='string'&&/^https:\/\//.test(v);
export function observedSeats(session,{availability={},now=Date.now()}={}){
  const rows=[availability.sessions?.get?.(session.id),availability.sessions?.[session.id],session.seat_data].filter(v=>v&&Number.isInteger(v.available)&&v.available>=0&&Number.isFinite(Date.parse(v.checked_at))).sort((a,b)=>Date.parse(b.checked_at)-Date.parse(a.checked_at));
  const value=rows[0];
  if(!value||now-Date.parse(value.checked_at)>(availability.intervalSeconds||900)*1000||Date.parse(value.checked_at)>now+60000||availability.failed||availability.errors?.has?.(session.id))return null;
  return value;
}
export function admissionPrice(session){
  const p=session.price_data;
  if(!p||p.currency!=='EUR'||!sourceOK(p.source_url)||!Number.isFinite(Date.parse(p.checked_at)))return null;
  // A minimum fare may require membership. Only explicit general admission
  // (or explicitly free admission) is comparable across screenings.
  const general=p.options?.find(o=>/^(general|general admission|adult|adulto|adulte|entrada general)$/i.test(o.label||o.name||''));
  const amount=general?.amount??(['general_admission','published_admission','published_event_price','free_admission','single','exact'].includes(p.kind)?p.amount:null);
  return typeof amount==='number'&&Number.isFinite(amount)&&amount>=0?amount:null;
}
export function estimatedEnd(film,session){
  if(session.ends_at&&sourceOK(session.source_url)&&Number.isFinite(Date.parse(session.ends_at)))return Date.parse(session.ends_at);
  const runtime=session.runtime_minutes??film.details?.runtime_minutes??film.runtime_minutes;
  return typeof runtime==='number'&&runtime>0?Date.parse(session.starts_at)+(runtime+20)*60000:null;
}
function sourcedValues(film,session,cinema,field){
  return [...(film.search_facts||[]),...(film.details?.search_facts||[]),...(session.search_facts||[]),...(cinema?.search_facts||[])].filter(f=>f.field===field&&sourceOK(f.source_url)&&f.status!=='conflict'&&f.status!=='historical'&&(!f.session_id||f.session_id===session.id)&&(!f.room||f.room===session.room));
}
export function matchesOuting(film,session,c,cinema,context={}){
  const now=context.now??Date.now(),d=film.details||{};
  if(c.field==='finish_time'){
    const end=estimatedEnd(film,session);if(end===null)return false;
    const startParts=(/^\d{2}:\d{2}$/.test(session.time||'')?session.time:madridClock.format(new Date(session.starts_at))).split(':');
    const start=Number(startParts[0])*60+Number(startParts[1]),minutes=start+(end-Date.parse(session.starts_at))/60000;
    const threshold=Number(c.value)+(Number(c.value)<360&&start>=1080?1440:0);
    return compare(minutes,c.op,threshold);
  }
  if(c.field==='starts_within'){const minutes=(Date.parse(session.starts_at)-now)/60000;return minutes>=0&&numeric(minutes,c);}
  if(c.field==='distance_km')return numeric(distanceKm(context.origin,cinema?.location),c);
  if(c.field==='price_eur')return numeric(admissionPrice(session),c);
  if(['seats_available','seats_together','occupancy_percent','wheelchair_seats','booking_open'].includes(c.field)){
    const seats=observedSeats(session,context);if(!seats)return false;
    if(c.field==='booking_open')return typeof seats.purchase_open==='boolean'&&compare(seats.purchase_open,c.op,c.value==='true');
    if(seats.purchase_open===false)return false;
    if(c.field==='seats_available')return numeric(seats.available,c);
    if(c.field==='wheelchair_seats')return numeric(seats.wheelchair,c);
    if(c.field==='occupancy_percent')return typeof seats.capacity==='number'&&seats.capacity>=seats.available&&seats.capacity>0&&numeric(100*(1-seats.available/seats.capacity),c);
    // Only a collector-verified adjacency count can satisfy together.
    return seats.adjacency_verified===true&&numeric(seats.max_adjacent,c);
  }
  if(c.field==='has_subtitles'){
    const parsed=parseLanguages(session.subtitles);
    const value=session.subtitles_confirmed_none===true?false:parsed.complete&&parsed.codes.length?true:null;
    return value!==null&&compare(value,c.op,c.value==='true');
  }
  if(c.field==='audio_only'){const audio=screeningAudio(film,session);return audio.complete&&audio.codes.length===1&&textMatches(audio.codes,{...c,value:parseLanguages(c.value).codes.join('|')});}
  if(c.field==='film_id')return textMatches([film.id,...(film.merged_ids||[])],c);
  if(c.field==='keyword'){
    const words=fold([film.title,film.original_title,film.english_title,...(film.titles||[]),...['directors','cast','genres','countries','languages','topics'].flatMap(k=>d[k]||[]),cinema?.name,cinema?.short,session.provider,session.language,session.subtitles].join(' ')).split(' ');
    return c.value.split('|').some(value=>fold(value).split(' ').every(term=>words.some(word=>word.startsWith(term))));
  }
  const credit={director:'directors',actor:'cast',writer:'writers',composer:'composers',cinematographer:'cinematographers'}[c.field];
  if(credit)return textMatches(d[credit]||[],c);
  if(c.field==='adaptation'&&d.based_on?.length)return compare(true,c.op,c.value==='true');
  const evidence=sourcedValues(film,session,cinema,c.field);
  if(c.field==='age_max')return evidence.some(e=>e.territory==='ES'&&numeric(e.value,c));
  if(c.field==='content_warning'&&c.op==='ne')return evidence.some(e=>fold(e.value)===fold(c.value)&&e.present===false);
  if(OUTING_BOOLEAN.includes(c.field))return evidence.some(e=>typeof e.value==='boolean'&&compare(e.value,c.op,c.value==='true'));
  if(['award','nomination'].includes(c.field))return evidence.some(e=>fold(e.value).includes(fold(c.value))&&c.op!=='ne');
  return textMatches(evidence.map(e=>e.value).filter(v=>typeof v==='string'),c);
}

export function outingSortValue(film,sort,context){
  if(!['price','seats','finish','duration','duration_desc'].includes(sort))return 0;
  if(sort==='duration'||sort==='duration_desc'){
    const runtime=film.details?.runtime_minutes??film.runtime_minutes;
    return Number.isFinite(runtime)&&runtime>0?(sort==='duration_desc'?-runtime:runtime):Infinity;
  }
  const values=film.sessions.map(s=>sort==='price'?admissionPrice(s):sort==='seats'?observedSeats(s,context)?.available:sort==='finish'?estimatedEnd(film,s):null).filter(v=>typeof v==='number'&&Number.isFinite(v));
  return values.length?(sort==='seats'?-Math.max(...values):Math.min(...values)):Infinity;
}

export function makeItineraries(films,options,{limit=8}={}){
  if(!options)return [];
  const byVenue=new Map();
  for(const film of films)for(const session of film.sessions){
    const end=estimatedEnd(film,session);if(end===null)continue;
    const key=session.cinema_id+':'+session.date;
    if(!byVenue.has(key))byVenue.set(key,[]);
    byVenue.get(key).push({film,session,end,start:Date.parse(session.starts_at)});
  }
  const result=[];
  for(const rows of byVenue.values()){
    rows.sort((a,b)=>a.start-b.start);
    function extend(path,offset){
      if(result.length>=limit)return;
      if(path.length===options.count){result.push(path);return;}
      for(let i=offset;i<rows.length&&result.length<limit;i++){
        const next=rows[i],last=path.at(-1);
        if(path.some(row=>row.film.id===next.film.id))continue;
        if(last){const gap=(next.start-last.end)/60000;if(gap<options.min_gap)continue;if(gap>options.max_gap)break;}
        extend([...path,next],i+1);
      }
    }
    extend([],0);
    if(result.length>=limit)break;
  }
  return result;
}
