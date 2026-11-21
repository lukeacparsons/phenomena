import {languageRows,parseLanguages,screeningAudio,hasNonEnglishAudio} from './screening-language.js';
import {OUTING_FIELDS,OUTING_NUMERIC,OUTING_BOOLEAN,OUTING_SORTS,outingDefaults,parseOuting,matchesOuting,admissionPrice} from './outing-search.js';
// Shared, deterministic search semantics. Models may propose these conditions;
// only this code decides whether a film or an individual screening satisfies them.
export const fold=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const dictionaries={
  colour:[['black-and-white','black and white','monochrome','blanco y negro','blanc i negre'],['color','colour','color film']],
  genre:[['Comedy','comedia','comèdia','funny','humorous','divertidas','divertida','divertides','divertit'],['Drama','dramas','drames'],['Horror','terror','scary'],['Science fiction','sci fi','scifi','ciencia ficción','ciència ficció'],['Thriller','suspense','suspens','Mystery & Thriller'],['Mystery','misterio','misteri'],['Romance','romantic','romántica','romàntica','románticas','romàntiques'],['Action','acción','acció'],['Adventure','aventura','aventuras','aventures'],['Animation','animated','animación','animació'],['Documentary','documentaries','documental','documentales','documentals'],['Fantasy','fantasía','fantasia'],['Family','familiar'],['Musical','musicales','musicals'],['War','bélico','bèl·lic'],['Western'],['Anime']],
  country:[['France','Francia','França'],['Spain','España','Espanya'],['United States','USA','US','Estados Unidos','Estats Units'],['United Kingdom','UK','Reino Unido','Regne Unit'],['Italy','Italia','Itàlia'],['Germany','Alemania','Alemanya'],['Japan','Japón','Japó'],['South Korea','Corea del Sur','Corea del Sud'],['China','Xina'],['Portugal'],['Mexico','México','Mèxic'],['Argentina'],['Canada','Canadá','Canadà'],['Brazil','Brasil'],['India','Índia'],['Iran','Irán'],['Belgium','Bélgica','Bèlgica'],['Australia','Austràlia'],['Ireland','Irlanda'],['Sweden','Suecia','Suècia']],
  language:languageRows
};
const lookups=Object.fromEntries(Object.entries(dictionaries).map(([field,rows])=>[field,new Map(rows.flatMap(row=>row.map(alias=>[fold(alias),row[0]])))]));
export const canonical=(field,value)=>lookups[field==='subtitles'?'language':field]?.get(fold(value))||String(value).trim();
export const fields=['genre','country','language','subtitles','non_english_audio','city','colour','producer','company','distributor','provider','cinema','format','rating_rt','rating_audience','rating_imdb','rating_filmaffinity','reviews_rt','release_year','duration','start_time','date','certified_fresh',...OUTING_FIELDS];
const numeric={rating_rt:100,rating_audience:100,rating_imdb:10,rating_filmaffinity:10,reviews_rt:10000000,release_year:2999,duration:1440,start_time:1439,...OUTING_NUMERIC};
const ops=['eq','ne','gt','gte','lt','lte','in'];
export const emptyIntent=()=>({text:'',conditions:[],semantic_query:'',location_query:'',sort:'soonest',unsupported:[],...outingDefaults()});
export const conditionId=({field,op,value})=>field+':'+op+':'+fold(value);
const esc=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const comparison=value=>({'>':'gt','>=':'gte','≥':'gte','<':'lt','<=':'lte','≤':'lte','=':'eq','==':'eq'}[value]||(/under|less|below|menos|menys|before|antes|abans/.test(value)?'lt':/at least|minimum|al menos|com a minim|a partir/.test(value)?'gte':'gt'));

export function validateIntent(value,programme){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!Object.keys(emptyIntent()).includes(key)))throw new Error('Invalid search interpretation');
  const result={...emptyIntent(),...value};
  if(typeof result.location_query!=='string'||result.location_query.length>300||/[\x00-\x1f]/.test(result.location_query))throw new Error('Invalid search location');
  result.location_query=result.location_query.trim();
  for(const field of ['text','semantic_query'])if(typeof result[field]!=='string'||result[field].length>500)throw new Error('Invalid search text');
  if(!['soonest','rating','relevance',...OUTING_SORTS].includes(result.sort)||!Array.isArray(result.conditions)||result.conditions.length>20||!Array.isArray(result.unsupported)||result.unsupported.length>5||result.unsupported.some(x=>typeof x!=='string'||x.length>160))throw new Error('Invalid search interpretation');
  if(!['upcoming','past','catalogue'].includes(result.scope)||typeof result.venue_query!=='string'||!['','belongings','transport','seating','accessibility','booking'].includes(result.venue_query))throw new Error('Invalid search scope');
  if(!Array.isArray(result.notices)||result.notices.length>20||result.notices.some(n=>typeof n!=='string'||n.length>160))throw new Error('Invalid notices');
  for(const key of ['alternatives','preferences'])if(!Array.isArray(result[key])||result[key].length>6)throw new Error('Invalid search groups');
  result.alternatives=result.alternatives.map(group=>{
    if(!Array.isArray(group)||!group.length)throw new Error('Empty search alternative');
    return validateIntent({...emptyIntent(),conditions:group},programme).conditions;
  });
  result.preferences=result.preferences.map(p=>{
    if(!p||Object.keys(p).some(k=>!['conditions','weight'].includes(k))||!Array.isArray(p.conditions)||!p.conditions.length||!Number.isInteger(p.weight)||p.weight<1||p.weight>10)throw new Error('Invalid search preference');
    return {conditions:validateIntent({...emptyIntent(),conditions:p.conditions},programme).conditions,weight:p.weight};
  });
  if(result.itinerary!==null){
    const i=result.itinerary;
    if(!i||Object.keys(i).some(k=>!['count','min_gap','max_gap','same_cinema'].includes(k))||!Number.isInteger(i.count)||i.count<2||i.count>3||!Number.isInteger(i.min_gap)||i.min_gap<0||i.min_gap>300||!Number.isInteger(i.max_gap)||i.max_gap<i.min_gap||i.max_gap>480||i.same_cinema!==true)throw new Error('Invalid itinerary');
  }
  const venues=new Set(programme?.cinemas.map(c=>c.id)||[]);
  const providers=new Set(programme?.films.flatMap(f=>f.sessions.map(s=>fold(s.provider)))||[]);
  const formats=new Set(programme?.films.flatMap(f=>f.sessions.flatMap(s=>(s.formats||[]).map(fold)))||[]);
  result.conditions=result.conditions.map(c=>{
    if(!c||Object.keys(c).some(k=>!['field','op','value'].includes(k))||!fields.includes(c.field)||!ops.includes(c.op)||typeof c.value!=='string'||!c.value||c.value.length>150)throw new Error('Invalid search condition');
    if(c.field in numeric){
      if(c.op==='in'||!/^\d+(?:\.\d+)?$/.test(c.value)||Number(c.value)>numeric[c.field])throw new Error('Invalid numeric condition');
      if(c.field==='release_year'&&(!/^\d{4}$/.test(c.value)||Number(c.value)<1800))throw new Error('Invalid release year');
    }else if(c.field==='date'){
      if(!/^\d{4}-\d{2}-\d{2}$/.test(c.value)||!Number.isFinite(Date.parse(c.value))||new Date(c.value+'T12:00Z').toISOString().slice(0,10)!==c.value||c.op==='in')throw new Error('Invalid date condition');
    }else if(['certified_fresh','non_english_audio',...OUTING_BOOLEAN].includes(c.field)){
      if(!['true','false'].includes(c.value)||!['eq','ne'].includes(c.op))throw new Error('Invalid badge condition');
    }else{
      if(!['eq','ne','in'].includes(c.op))throw new Error('Invalid text condition');
      const values=c.op==='in'?c.value.split('|'):[c.value];
      if(values.length>20||values.some(v=>!v.trim()))throw new Error('Invalid text condition');
      for(const v of values){
        if(c.field==='cinema'&&programme&&!venues.has(v))throw new Error('Unknown cinema');
        if(c.field==='provider'&&programme&&!providers.has(fold(v)))throw new Error('Unknown operator');
        if(c.field==='format'&&programme&&!formats.has(fold(v)))throw new Error('Unknown format');
      }
    }
    return {...c};
  });
  result.conditions=[...new Map(result.conditions.map(c=>[conditionId(c),c])).values()];
  return result;
}

export function parseIntent(text,options={}){
  return parseOuting(text,{today:new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Madrid'}).format(new Date()),...options},parseBasicIntent);
}
function parseBasicIntent(text,{programme,exactTitle=false,protectedNames=[],today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Madrid'}).format(new Date())}={}){
  const plan={...emptyIntent(),text};
  if(exactTitle||!text.trim())return plan;
  if(programme){
    const phrase=fold(text),negative=/^(?:not|except|without|sin|sense)\s+/.test(phrase);
    const name=phrase.replace(/^(?:not|except|without|sin|sense)\s+/,'').replace(/^(?:at|en|a)\s+/,'');
    const provider=programme.films.flatMap(f=>f.sessions).find(s=>s.provider&&fold(s.provider)===name)?.provider;
    const venue=programme.cinemas.find(c=>[c.short,c.name].some(v=>v&&fold(v)===name));
    if(provider||venue)return {...plan,text:'',conditions:[{field:provider?'provider':'cinema',op:negative?'ne':'eq',value:provider||venue.id}]};
  }
  // Unstructured regional origins remain text for AI discovery. They are not
  // equivalent to a production country or an audio-language requirement.
  // Keep operators until parsed. The ordinary keyword normalizer strips > and <.
  let rest=String(text).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[’'·]/g,' ');
  let changed=false;
  const add=(field,op,value)=>{plan.conditions.push({field,op,value:String(value)});changed=true;};
  // Qualified producer credits are distinct from the ordinary cast/name search.
  const companies=[...new Set(programme?.films.flatMap(f=>[...(f.details?.studios||[]),...(f.details?.distributors||[])])||[])].sort((a,b)=>b.length-a.length);
  const producers=[...new Set(programme?.films.flatMap(f=>[...(f.details?.producers||[]),...(f.details?.studios||[])])||[])].sort((a,b)=>b.length-a.length);
  for(const name of /\b(?:or|o)\b/.test(rest)?[]:producers){
    if(!rest.includes(fold(name)))continue;
    rest=rest.replace(new RegExp('\\b(?:produced by|producer|producid[ao]s? por|produid[ae]s? per)\\s+'+esc(fold(name))+'\\b','g'),()=>{add('producer','eq',name);return ' ';});
  }
  const venuesAndChains=new Set([...(programme?.films.flatMap(f=>f.sessions.map(s=>fold(s.provider)))||[]),...(programme?.cinemas.flatMap(c=>[fold(c.short),fold(c.name)])||[])]);
  for(const name of companies){
    if(!rest.includes(fold(name)))continue;
    const company=esc(fold(name));
    rest=rest.replace(new RegExp('\\b(?:distributed by|distribuid[ao]s? por|distribuid[ae]s? per)\\s+'+company+'\\b','g'),()=>{add('distributor','eq',name);return ' ';});
    // A bare company is a catalogue association, not a person's producer credit.
    const bare=new RegExp('^(?:(?:show me|find me)\\s+)?(?:(?:movies?|films?|peliculas?|pel licules)\\s+(?:(?:from|by|de)\\s+)?)?'+company+'(?:\\s+(?:movies?|films?|peliculas?|pel licules))?$');
    if(!venuesAndChains.has(fold(name))&&bare.test(rest.trim())){add('company','eq',name);rest=' ';}
  }
  const protectedText=[];
  for(const name of [...protectedNames].sort((a,b)=>b.length-a.length)){
    rest=rest.replace(new RegExp('\\b'+fold(name).split(' ').map(esc).join('[\\s\\W]+')+'\\b','g'),matched=>{
      const token='zzprotected'+protectedText.length+'zz';protectedText.push([token,matched]);return token;
    });
  }
  // Compound alternatives need the interpreter's complete expression. Parsing
  // just one side would accidentally turn an OR into a mandatory AND condition.
  if(/\b(?:or|o)\b/.test(rest)){
    let other=rest;
    for(const provider of new Set(programme?.films.flatMap(f=>f.sessions.map(s=>s.provider).filter(Boolean))||[]))other=other.replace(new RegExp('\\b'+esc(fold(provider))+'\\b','g'),' ');
    if(other.replace(/\b(?:or|o|at|en|movies|films|show me)\b/g,' ').trim())return plan;
  }
  const consume=(pattern,callback)=>{rest=rest.replace(pattern,(...args)=>{callback(...args);return ' ';});};
  // Year precision is explicit in the chip; a cinema showing is never a release date.
  if(!/\b(?:week|month|days?|semana|mes|setmana|mesos|dies)\b/.test(rest))
    consume(/\b(?:new releases|latest releases|recent releases|new movies|new films|nuevos estrenos|estrenos recientes|estrenos|novetats|noves estrenes|estrenes recents|estrenes)\b/g,()=>add('release_year','eq',today.slice(0,4)));
  consume(/\b(?:(not|no|without|sin|sense)\s+)?(?:black[ -]+and[ -]+white|monochrome|blanco y negro|blanc i negre)\b/g,(_,negative)=>add('colour',negative?'ne':'eq','black-and-white'));
  // Release dates are film metadata; story settings and screening dates remain distinct.
  if(!/\b(?:set|setting|ambientad|ambientat|about|sobre)\b/.test(rest)){
    consume(/\b((?:19|20)?[0-9]0)\s*s\s+(?:released|releases|movies|films)\b|\b(?:released|made)\s+in\s+(?:the\s+)?((?:19|20)?[0-9]0)\s*s\b/g,(_,suffix,prefix)=>{
      let year=Number(suffix||prefix);if(year<100)year+=year>=30?1900:2000;
      add('release_year','gte',year);add('release_year','lte',year+9);
    });
    consume(/\b(?:released|made)\s+in\s+((?:18|19|20)\d{2})\b/g,(_,year)=>add('release_year','eq',year));
  }
  // Source-qualified subjective ratings belong to the interpreter. Do not
  // install an RT default that could override a later IMDb interpretation.
  const namedRatingSource=/\b(?:imdb|film\s*affinity|rotten\s+tomatoes|rt|tomatometer|audience|popcornmeter)\b/.test(rest);
  consume(/\b(?:(not|no|without|sin|sense)\s+)?(?:certified\s+fresh|certificado\s+fresh|certificada\s+fresh|certificat\s+fresh)\b/g,(_,negative)=>add('certified_fresh','eq',negative?'false':'true'));
  const ratingNames='rt(?:\\s+(?:critics|critica|critics score))?|rotten\\s+tomatoes|tomatometer|imdb|film\\s*affinity|fa|rt\\s+audience|audience|popcornmeter|publico|public';
  consume(new RegExp('\\b('+ratingNames+')\\s*(>=|<=|>|<|≥|≤|==|=|above|over|under|at least|more than|less than|mas de|menos de|mes de|menys de)\\s*(\\d+(?:[.,]\\d+)?)\\s*(?:%|/\\s*(?:10|100))?','g'),(_,name,op,n)=>{
    const field=/audience|popcorn|public/.test(name)?'rating_audience':name==='imdb'?'rating_imdb':/affinity|^fa$/.test(name)?'rating_filmaffinity':'rating_rt';
    add(field,comparison(op),n.replace(',','.'));
  });
  if(!namedRatingSource)consume(/\b(?:good reviews|well[ -]reviewed|critically acclaimed|buenas criticas|bien valoradas|mejores criticas|bones critiques|ben valorades)\b/g,()=>{
    // An explicit RT comparison wins over this subjective default.
    if(!plan.conditions.some(c=>c.field==='rating_rt'))add('rating_rt','gte',80);
    add('reviews_rt','gte',20);plan.sort='rating';
  });
  consume(/\b(?:under|less than|below|over|more than|menos de|menys de|mas de|mes de)\s+(\d+(?:[.,]\d+)?|one|two|three|una?|dos|dues)\s*(hours?|hrs?|horas?|hores?|minutes?|mins?|minutos?|minuts?)\b/g,(whole,n,unit)=>{
    const numbers={one:1,two:2,three:3,un:1,una:1,dos:2,dues:2};
    const value=(numbers[n]||Number(n.replace(',','.')))*(/^(h|hor)/.test(unit)?60:1);
    add('duration',comparison(whole),value);
  });
  consume(/\b(after|before|despues de|antes de|a partir de|despres de|abans de)\s+(?:las?\s+|les\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/g,(_,op,h,m,period)=>{
    let hour=Number(h);if(period)hour=hour%12+(period==='pm'?12:0);
    if(hour>23||Number(m||0)>59){plan.unsupported.push('Invalid screening time');changed=true;return;}
    add('start_time',/before|antes|abans/.test(op)?'lt':/a partir/.test(op)?'gte':'gt',hour*60+Number(m||0));
  });
  // Consume subtitle phrases before audio: "subtitles in English" is not English audio.
  const subtitleWord='(?:subtitles?|subs|subtitulos?|subtitols?|subtitled|subtitulad[ao]s?|subtitulad[ae]s?)';
  for(const row of /\b(?:subtitles?|subs|subtitulos?|subtitols?|subtitled|subtitulad[ao]s?|subtitulad[ae]s?)\b/.test(rest)?languageRows:[]){
    if(!row.some(name=>fold(name).length>=3&&rest.includes(fold(name))))continue;
    const names=row.filter(name=>fold(name).length>=3).map(name=>esc(fold(name))).sort((a,b)=>b.length-a.length).join('|');
    consume(new RegExp('\\b(?:(not|no|without|sin|sense)\\s+)?(?:('+names+')[- ]+'+subtitleWord+'|'+subtitleWord+'\\s+(?:(?:in|en)\\s+)?('+names+'))\\b','g'),(_,negative)=>add('subtitles',negative?'ne':'eq',row[0]));
  }
  consume(/\b(?:(not|no|without|sin|sense)\s+)?(vosi|vosa|vose|vosc)\b/g,(_,negative,tag)=>add('subtitles',negative?'ne':'eq',{vosi:'English',vosa:'English',vose:'Spanish',vosc:'Catalan'}[tag]));
  consume(/\b(?:(not|no)\s+)?(?:foreign[- ]language|non[- ]english(?:[- ]language)?|idiomas? distintos? del ingles|idiomes? diferents? de l angles)\b/g,(_,negative)=>add('non_english_audio','eq',negative?'false':'true'));
  consume(/\b(?:in|en|a)\s+barcelona\b/g,()=>add('city','eq','Barcelona'));
  // Specific origin/audio phrases avoid the old "French" language/origin ambiguity.
  for(const field of ['country','language']){
    const values=new Set([...(dictionaries[field]||[]).flat(),...(programme?.films.flatMap(f=>f.details?.[field==='country'?'countries':'languages']||[])||[])]);
    for(const name of [...values].sort((a,b)=>b.length-a.length)){
      if(fold(name).length<3||!rest.includes(fold(name)))continue;
      const prefix=field==='country'?'(?:from|made in|produced in|de|producidas? en|producides? a)':'(?:in|spoken in|audio in|en|audio en)';
      consume(new RegExp('\\b(?:(not|no|without|sin|sense)\\s+)?'+prefix+'\\s+'+esc(fold(name))+'\\b','g'),(_,negative)=>add(field,negative?'ne':'eq',canonical(field,name)));
    }
  }
  // Chain and venue words can combine with structured constraints and semantics.
  if(programme){
    const providers=[...new Set(programme.films.flatMap(f=>f.sessions.map(s=>s.provider).filter(Boolean)))].sort((a,b)=>b.length-a.length);
    const selected=[];
    for(const provider of providers){
      if(protectedNames.some(name=>(' '+fold(name)+' ').includes(' '+fold(provider)+' ')))continue;
      consume(new RegExp('\\b(?:(not|except|without|sin|sense)\\s+(?:at\\s+)?)?'+esc(fold(provider))+'\\b','g'),(_,negative)=>{if(negative)add('provider','ne',provider);else selected.push(provider);});
    }
    if(selected.length>1&&/\b(?:or|o)\b/.test(fold(text)))add('provider','in',selected.join('|'));
    else for(const provider of selected)add('provider','eq',provider);
    for(const venue of [...programme.cinemas].sort((a,b)=>(b.short||b.name||'').length-(a.short||a.name||'').length)){
      const name=fold(venue.short||venue.name);if(name.length<3)continue;
      consume(new RegExp('\\b(?:(not|except|without|sin|sense)\\s+(?:at\\s+)?)?'+esc(name)+'\\b','g'),(_,negative)=>add('cinema',negative?'ne':'eq',venue.id));
    }
    const formats=[...new Set(programme.films.flatMap(f=>f.sessions.flatMap(s=>s.formats||[])))];
    for(const format of formats)consume(new RegExp('\\b'+esc(fold(format))+'\\b','g'),()=>add('format','eq',format));
  }
  const filler=/\b(?:show me|find me|looking for|i want|i d like|quiero ver|quiero|busco|vull veure|vull|busca|recomiendame|recomana m|movies?|films?|peliculas?|pelis|pel licules|cinema|cine|de|d|with|and|or|at|the|a|an|some|con|y|o|en|el|la|los|las|un|una|unes|uns|amb|i|al|a les|a las)\b/g;
  const genrePatterns=dictionaries.genre.map(row=>({genre:row[0],pattern:new RegExp('\\b(?:(not|no|without|sin|sense)\\s+)?(?:'+row.map(fold).sort((a,b)=>b.length-a.length).map(esc).join('|')+')\\b','g')}));
  // A genre word inside a topic (civil war, family secrets, action against
  // injustice) is ambiguous. Let the interpreter consider the complete phrase.
  const genreOnly=!genrePatterns.reduce((text,{pattern})=>text.replace(pattern,' '),rest).replace(filler,' ').trim();
  for(const {genre,pattern} of genrePatterns){
    rest=rest.replace(pattern,(whole,negative)=>{
      if(!genreOnly&&!negative)return whole;
      add('genre',negative?'ne':'eq',genre);return ' ';
    });
  }
  if(changed){
    rest=rest.replace(filler,' ');
    plan.text=rest.replace(/\s+/g,' ').trim();
    for(const [token,original] of protectedText)plan.text=plan.text.replaceAll(token,original);
  }
  return plan;
}

export function effectiveIntent(plan,ignored=[]){
  return {...outingDefaults(),...plan,conditions:plan.conditions.filter(c=>!ignored.includes(conditionId(c))),semantic_query:ignored.includes('semantic')?'':plan.semantic_query,
    sort:ignored.includes('sort')?'soonest':plan.sort,scope:ignored.includes('scope')?'upcoming':plan.scope||'upcoming',
    location_query:ignored.includes('location')?'':plan.location_query||'',
    alternatives:ignored.includes('alternatives')?[]:(plan.alternatives||[]),preferences:ignored.includes('preferences')?[]:(plan.preferences||[]),itinerary:ignored.includes('itinerary')?null:plan.itinerary||null};
}

export function filmMatchReason(film,plan,language='en'){
  const country=plan.conditions.find(c=>c.field==='country'&&c.op!=='ne');
  const company=plan.conditions.find(c=>['company','distributor','producer'].includes(c.field)&&c.op!=='ne');
  const labels={en:{production:'Production',coproduction:'Co-production',producer:'Produced by',distributor:'Distributed by'},es:{production:'Producción',coproduction:'Coproducción',producer:'Producida por',distributor:'Distribuida por'},ca:{production:'Producció',coproduction:'Coproducció',producer:'Produïda per',distributor:'Distribuïda per'}}[language]||{};
  if(country){
    const countries=film.details?.countries||[];
    const matched=country.value.split('|').find(v=>countries.some(c=>fold(canonical('country',c))===fold(canonical('country',v))));
    if(!matched)return null;
    const evidence=film.details?.country_provenance?.find(p=>fold(canonical('country',p.country))===fold(canonical('country',matched)))?.sources?.[0];
    return {label:(countries.length>1?labels.coproduction:labels.production)+': '+countries.join(' / '),sourceURL:evidence?.source_url||'',source:evidence?.source||''};
  }
  if(company){
    const wanted=company.value.split('|'),d=film.details||{};
    const produced=wanted.filter(v=>[...(d.studios||[]),...(d.producers||[])].some(c=>fold(c)===fold(v)));
    const distributed=wanted.filter(v=>(d.distributors||[]).some(c=>fold(c)===fold(v)));
    return {label:[produced.length?labels.producer+': '+produced.join(' / '):'',distributed.length?labels.distributor+': '+distributed.join(' / '):''].filter(Boolean).join(' · ')};
  }
  if(plan.sort==='price'||plan.conditions.some(c=>c.field==='price_eur')){
    const priced=film.sessions.map(session=>({session,price:admissionPrice(session)})).filter(row=>row.price!==null).sort((a,b)=>a.price-b.price);
    const copy={en:{label:'Published admission from',unknown:'Admission price not confirmed'},es:{label:'Entrada publicada desde',unknown:'Precio de entrada sin confirmar'},ca:{label:'Entrada publicada des de',unknown:'Preu d’entrada sense confirmar'}}[language];
    if(priced.length)return {label:copy.label+' '+new Intl.NumberFormat(language,{style:'currency',currency:'EUR'}).format(priced[0].price),sourceURL:priced[0].session.price_data.source_url,source:priced[0].session.price_data.checked_at};
    return {label:copy.unknown};
  }
  const evidenceCondition=plan.conditions.find(c=>['award','nomination','event','edition','age_max','content_warning','adaptation_kind'].includes(c.field));
  if(evidenceCondition){
    const fact=[...(film.details?.search_facts||[]),...film.sessions.flatMap(s=>s.search_facts||[])].find(f=>f.field===evidenceCondition.field&&f.source_url);
    if(fact)return {label:intentChips({...emptyIntent(),conditions:[evidenceCondition]},language)[0].label,sourceURL:fact.source_url,source:fact.checked_at||''};
  }
  return null;
}

export function searchExplanation(plan,language='en'){
  const copy={en:{countries:'Includes co-productions'},es:{countries:'Incluye coproducciones'},ca:{countries:'Inclou coproduccions'}}[language];
  return plan.conditions.some(c=>c.field==='country'&&c.op!=='ne')?copy.countries:'';
}

const compare=(actual,op,wanted)=>({eq:()=>actual===wanted,ne:()=>actual!==wanted,gt:()=>actual>wanted,gte:()=>actual>=wanted,lt:()=>actual<wanted,lte:()=>actual<=wanted}[op]?.()??false);
function textMatch(values,c){
  if(!values.length)return false; // Unknown metadata cannot satisfy a positive or negative condition.
  const actual=values.map(v=>fold(canonical(c.field,v)));
  const wanted=c.value.split('|').map(v=>fold(canonical(c.field,v)));
  // Mixed formats or contradictory colour claims do not establish a monochrome film.
  if(c.field==='colour'&&c.op==='eq'&&wanted[0]==='black and white'&&actual.includes('color'))return false;
  return c.op==='ne'?wanted.every(v=>!actual.includes(v)):wanted.some(v=>actual.includes(v));
}
export function ratingValue(film,field){
  const key={rating_rt:'rotten_tomatoes',reviews_rt:'rotten_tomatoes',rating_imdb:'imdb',rating_filmaffinity:'filmaffinity'}[field];
  const rating=field==='rating_audience'?film.ratings?.rotten_tomatoes?.audience:film.ratings?.[key];
  const value=field==='reviews_rt'?rating?.count:rating?.score;
  return typeof value==='number'&&Number.isFinite(value)?value:null;
}
export function matchesConditions(film,session,conditions,cinema,context={}){
  return conditions.every(c=>{
    if(OUTING_FIELDS.includes(c.field))return matchesOuting(film,session,c,cinema,context);
    let value;
    if(c.field.startsWith('rating_')||c.field==='reviews_rt')value=ratingValue(film,c.field);
    else if(c.field==='city')return textMatch(cinema?.area?[cinema.area.split('·')[0].trim()]:[],c);
    else if(c.field==='release_year')value=film.release_year??film.details?.release_year;
    else if(c.field==='duration')value=film.details?.runtime_minutes??film.runtime_minutes;
    else if(c.field==='start_time'){
      const time=session.time||session.starts_at?.match(/T(\d\d:\d\d)/)?.[1];
      value=/^\d\d:\d\d$/.test(time||'')?Number(time.slice(0,2))*60+Number(time.slice(3,5)):null;
    }else if(c.field==='date')return Boolean(session.date)&&compare(session.date,c.op,c.value);
    else if(c.field==='non_english_audio'){
      const audio=screeningAudio(film,session);
      const wanted=(c.value==='true')!==(c.op==='ne');
      return wanted?hasNonEnglishAudio(audio):audio.complete&&audio.codes.every(code=>code==='en');
    }else if(c.field==='language'){
      const audio=screeningAudio(film,session);
      if(audio.codes.length||session.language||audio.derived)
        return (c.op!=='ne'||audio.complete)&&textMatch(audio.codes,c);
      return textMatch(film.details?.language_status?.state==='conflict'?[]:film.details?.languages||[],c);
    }else if(c.field==='subtitles'){
      const subtitles=parseLanguages(session.subtitles);
      if(c.op==='ne'&&!subtitles.complete)return false;
      return textMatch(subtitles.codes,c);
    }else if(c.field==='certified_fresh'){
      value=film.ratings?.rotten_tomatoes?.certified_fresh;
      return typeof value==='boolean'&&compare(value,c.op,c.value==='true');
    }else{
      const values=c.field==='genre'?film.details?.genres:c.field==='country'?film.details?.countries:c.field==='colour'?film.details?.colours:
        c.field==='producer'?[...(film.details?.producers||[]),...(film.details?.studios||[])]:
        c.field==='company'?[...(film.details?.studios||[]),...(film.details?.distributors||[])]:c.field==='distributor'?film.details?.distributors:
        c.field==='provider'?[session.provider].filter(Boolean):c.field==='cinema'?[session.cinema_id]:session.formats;
      return textMatch(values||[],c);
    }
    return typeof value==='number'&&Number.isFinite(value)&&compare(value,c.op,Number(c.value));
  });
}

// Provider IDs identify collection feeds, which can represent a chain or one
// theatre. Keep known chains explicit: a snapshot may contain only one branch.
const cinemaChainNames=new Map(Object.entries({mooby:'Mooby',cinesa:'Cinesa',yelmo:'Yelmo',kinepolis:'Kinépolis',renoir:'Renoir',verdi:'Verdi'}));
function cinemaChipValue(field,value,programme){
  if(field==='cinema'){
    const venue=programme?.cinemas.find(c=>c.id===value);
    return {field:'cinema',value:venue?.short||venue?.name||value};
  }
  const provider=fold(value),chain=cinemaChainNames.get(provider);
  if(chain)return {field:'provider',value:chain};
  const ids=new Set(programme?.films.flatMap(f=>f.sessions.filter(s=>fold(s.provider)===provider).map(s=>s.cinema_id))||[]);
  const venues=programme?.cinemas.filter(c=>ids.has(c.id))||[];
  if(!venues.length){
    const venue=programme?.cinemas.find(c=>[c.id,c.short,c.name].some(name=>name&&fold(name)===provider));
    if(venue)venues.push(venue);
  }
  if(venues.length)return {field:'cinema',value:venues.map(c=>c.short||c.name||c.id).join(' / ')};
  return {field:'operator',value};
}

export function intentChips(plan,language='en',programme){
  const extraWords={en:{finish_time:'Estimated finish',starts_within:'Starts within',distance_km:'Distance',price_eur:'Admission',seats_available:'Available places',seats_together:'Adjacent seats',wheelchair_seats:'Wheelchair places',occupancy_percent:'Occupied',age_max:'Age classification',has_subtitles:'Subtitles',booking_open:'Booking open',adaptation:'Book adaptation',sequel:'Sequel',remake:'Remake',adaptation_kind:'Adapted from',silent:'Silent film',audio_only:'Only audio',director:'Director',actor:'Actor',writer:'Writer',composer:'Composer',cinematographer:'Cinematographer',film_id:'Film',keyword:'Matching',event:'Event',edition:'Edition',award:'Award won',nomination:'Nominated for',content_warning:'Content',venue_feature:'Room facility',alternatives:'Either',preferences:'Prefer',sort:'Order',scope:'Programme',itinerary:'Film outing',yes:'yes',no:'no'},es:{finish_time:'Final estimado',starts_within:'Empieza en',distance_km:'Distancia',price_eur:'Entrada',seats_available:'Plazas disponibles',seats_together:'Asientos contiguos',wheelchair_seats:'Plazas para silla de ruedas',occupancy_percent:'Ocupación',age_max:'Clasificación por edad',has_subtitles:'Subtítulos',booking_open:'Venta abierta',adaptation:'Adaptación de libro',sequel:'Secuela',remake:'Remake',adaptation_kind:'Adaptada de',silent:'Cine mudo',audio_only:'Único audio',director:'Dirección',actor:'Intérprete',writer:'Guion',composer:'Música',cinematographer:'Fotografía',film_id:'Película',keyword:'Coincide',event:'Evento',edition:'Edición',award:'Premio ganado',nomination:'Nominada a',content_warning:'Contenido',venue_feature:'Instalación de la sala',alternatives:'Una opción',preferences:'Preferencia',sort:'Orden',scope:'Programación',itinerary:'Plan de cine',yes:'sí',no:'no'},ca:{finish_time:'Final estimat',starts_within:'Comença en',distance_km:'Distància',price_eur:'Entrada',seats_available:'Places disponibles',seats_together:'Seients contigus',wheelchair_seats:'Places per a cadira de rodes',occupancy_percent:'Ocupació',age_max:'Classificació per edat',has_subtitles:'Subtítols',booking_open:'Venda oberta',adaptation:'Adaptació de llibre',sequel:'Seqüela',remake:'Remake',adaptation_kind:'Adaptada de',silent:'Cinema mut',audio_only:'Únic àudio',director:'Direcció',actor:'Intèrpret',writer:'Guió',composer:'Música',cinematographer:'Fotografia',film_id:'Pel·lícula',keyword:'Coincideix',event:'Esdeveniment',edition:'Edició',award:'Premi guanyat',nomination:'Nominada a',content_warning:'Contingut',venue_feature:'Instal·lació de la sala',alternatives:'Una opció',preferences:'Preferència',sort:'Ordre',scope:'Programació',itinerary:'Pla de cinema',yes:'sí',no:'no'}}[language]||{};
  const words={en:{colour:'Colour',release_year:'Released',producer:'Produced by',company:'Company',distributor:'Distributed by',genre:'Genre',country:'From',language:'Audio',city:'City',subtitles:'Subtitles',non_english_audio:'Non-English dialogue',provider:'Cinema chain',cinema:'Theatre',operator:'Cinema operator',format:'Format',duration:'Length',start_time:'Starts',date:'Date',reviews_rt:'RT reviews',not:'Not',semantic:'Theme',rating_rt:'RT critics',rating_audience:'RT audience',rating_imdb:'IMDb',rating_filmaffinity:'FilmAffinity'},es:{colour:'Color',release_year:'Estreno',producer:'Producida por',company:'Compañía',distributor:'Distribuida por',genre:'Género',country:'De',language:'Audio',city:'Ciudad',subtitles:'Subtítulos',non_english_audio:'Diálogo en otros idiomas',provider:'Cadena',cinema:'Cine',operator:'Operador',format:'Formato',duration:'Duración',start_time:'Empieza',date:'Fecha',reviews_rt:'Reseñas RT',not:'Sin',semantic:'Tema',rating_rt:'RT crítica',rating_audience:'RT público',rating_imdb:'IMDb',rating_filmaffinity:'FilmAffinity'},ca:{colour:'Color',release_year:'Estrena',producer:'Produïda per',company:'Companyia',distributor:'Distribuïda per',genre:'Gènere',country:'De',language:'Àudio',city:'Ciutat',subtitles:'Subtítols',non_english_audio:'Diàleg en altres idiomes',provider:'Cadena',cinema:'Cinema',operator:'Operador',format:'Format',duration:'Durada',start_time:'Comença',date:'Data',reviews_rt:'Ressenyes RT',not:'Sense',semantic:'Tema',rating_rt:'RT crítica',rating_audience:'RT públic',rating_imdb:'IMDb',rating_filmaffinity:'FilmAffinity'}}[language]||{};
  const symbols={eq:'',ne:words.not,gt:'>',gte:'≥',lt:'<',lte:'≤',in:''};
  const chips=plan.conditions.map(c=>{
    let value=c.value.replaceAll('|',' / ');
    if(['provider','cinema'].includes(c.field)){
      const values=c.value.split('|').map(value=>cinemaChipValue(c.field,value,programme));
      const sameKind=values.every(v=>v.field===values[0].field);
      const label=sameKind
        ?[words[values[0].field],symbols[c.op],values.map(v=>v.value).join(' / ')].filter(Boolean).join(' ')
        :values.map(v=>[words[v.field],symbols[c.op],v.value].filter(Boolean).join(' ')).join(' / ');
      return {id:conditionId(c),label};
    }
    if(c.field==='film_id')value=programme?.films.find(f=>f.id===c.value)?.title||value;
    if(c.field==='date')value=new Intl.DateTimeFormat(language,{timeZone:'Europe/Madrid',day:'numeric',month:'short',year:'numeric'}).format(new Date(c.value+'T12:00:00Z'));
    if(['start_time','finish_time'].includes(c.field))value=String(Math.floor(Number(c.value)/60)).padStart(2,'0')+':'+String(Number(c.value)%60).padStart(2,'0');
    if(['duration','starts_within'].includes(c.field))value+=' min';
    if(c.field==='duration'){
      const comparison=({en:{lt:'Under',lte:'Up to',gt:'Over',gte:'At least'},es:{lt:'Menos de',lte:'Hasta',gt:'Más de',gte:'Al menos'},ca:{lt:'Menys de',lte:'Fins a',gt:'Més de',gte:'Com a mínim'}}[language]||{})[c.op];
      if(comparison)return {id:conditionId(c),label:comparison+' '+value};
    }
    if(c.field==='distance_km')value+=' km';
    if(c.field==='price_eur')value+=' EUR';
    if(c.field==='occupancy_percent')value+='%';
    if(OUTING_BOOLEAN.includes(c.field))value=c.value==='true'?extraWords.yes:extraWords.no;
    if(['rating_rt','rating_audience'].includes(c.field))value+='%';
    if(c.field==='non_english_audio')return {id:conditionId(c),label:((c.value==='false')!==(c.op==='ne')?words.not+' ':'')+words.non_english_audio};
    if(c.field==='certified_fresh')return {id:conditionId(c),label:((c.value==='false')!==(c.op==='ne')?words.not+' ':'')+'Certified Fresh'};
    if(['language','subtitles'].includes(c.field)&&typeof Intl.DisplayNames==='function'){
      const row=dictionaries.language.find(r=>r[0]===canonical('language',c.value));
      if(row?.[1]?.length===2)value=new Intl.DisplayNames([language],{type:'language'}).of(row[1]);
    }
    return {id:conditionId(c),label:[words[c.field]||extraWords[c.field]||c.field,symbols[c.op],value].filter(Boolean).join(' ')};
  });
  const groupLabel=conditions=>intentChips({...emptyIntent(),conditions},language,programme).map(c=>c.label).join(' · ');
  if(plan.alternatives?.length)chips.push({id:'alternatives',label:extraWords.alternatives+': '+plan.alternatives.map(g=>'('+groupLabel(g)+')').join(language==='en'?' OR ':' O ')});
  if(plan.preferences?.length)chips.push({id:'preferences',label:extraWords.preferences+': '+plan.preferences.map(p=>groupLabel(p.conditions)).join(' / ')});
  if(plan.itinerary)chips.push({id:'itinerary',label:extraWords.itinerary+': '+plan.itinerary.count+' · '+plan.itinerary.min_gap+' min'});
  if(plan.scope&&plan.scope!=='upcoming')chips.push({id:'scope',label:extraWords.scope+': '+({en:{past:'past screenings',catalogue:'known films'},es:{past:'sesiones pasadas',catalogue:'películas conocidas'},ca:{past:'sessions passades',catalogue:'pel·lícules conegudes'}}[language]?.[plan.scope]||plan.scope)});
  if(OUTING_SORTS.includes(plan.sort))chips.push({id:'sort',label:extraWords.sort+': '+({en:{price:'lowest admission',duration:'shortest',duration_desc:'longest',seats:'most places',finish:'earliest finish',distance:'nearest'},es:{price:'menor precio',duration:'menor duración',duration_desc:'mayor duración',seats:'más plazas',finish:'final más temprano',distance:'más cerca'},ca:{price:'menor preu',duration:'menor durada',duration_desc:'major durada',seats:'més places',finish:'final més aviat',distance:'més a prop'}}[language]?.[plan.sort]||plan.sort)});
  if(plan.semantic_query)chips.push({id:'semantic',label:words.semantic+': '+plan.semantic_query});
  return chips;
}
