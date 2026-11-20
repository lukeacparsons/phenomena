// Shared, deterministic search semantics. Models may propose these conditions;
// only this code decides whether a film or an individual screening satisfies them.
export const fold=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const dictionaries={
  genre:[['Comedy','comedia','comèdia','funny','humorous','divertidas','divertida','divertides','divertit'],['Drama'],['Horror','terror','scary'],['Science fiction','sci fi','scifi','ciencia ficción','ciència ficció'],['Thriller','suspense','suspens','Mystery & Thriller'],['Mystery','misterio','misteri'],['Romance','romantic','romántica','romàntica'],['Action','acción','acció'],['Adventure','aventura','aventuras','aventures'],['Animation','animated','animación','animació'],['Documentary','documentaries','documental','documentales','documentals'],['Fantasy','fantasía','fantasia'],['Family','familiar'],['Musical'],['War','bélico','bèl·lic'],['Western'],['Anime']],
  country:[['France','Francia','França'],['Spain','España','Espanya'],['United States','USA','US','Estados Unidos','Estats Units'],['United Kingdom','UK','Reino Unido','Regne Unit'],['Italy','Italia','Itàlia'],['Germany','Alemania','Alemanya'],['Japan','Japón','Japó'],['South Korea','Corea del Sur','Corea del Sud'],['China','Xina'],['Portugal'],['Mexico','México','Mèxic'],['Argentina'],['Canada','Canadá','Canadà'],['Brazil','Brasil'],['India','Índia'],['Iran','Irán'],['Belgium','Bélgica','Bèlgica'],['Australia','Austràlia'],['Ireland','Irlanda'],['Sweden','Suecia','Suècia']],
  language:[['English','en','eng','inglés','anglès'],['French','fr','fra','fre','français','francés','francès'],['Spanish','es','spa','castellano','castellà','español','espanyol'],['Catalan','ca','cat','catalán','català'],['Italian','it','ita','italiano','italià'],['German','de','deu','alemán','alemany'],['Japanese','ja','jpn','japonés','japonès'],['Korean','ko','kor','coreano','coreà'],['Portuguese','pt','por','portugués','portuguès'],['Mandarin','cmn','mandarín','mandarí'],['Chinese','zh','zho','chino','xinès'],['Arabic','ar','ara','árabe','àrab'],['Hindi','hi','hin'],['Russian','ru','rus','ruso','rus'],['Basque','eu','eus','vasco','basc','euskera'],['Galician','gl','glg','gallego','gallec']]
};
const lookups=Object.fromEntries(Object.entries(dictionaries).map(([field,rows])=>[field,new Map(rows.flatMap(row=>row.map(alias=>[fold(alias),row[0]])))]));
export const canonical=(field,value)=>lookups[field]?.get(fold(value))||String(value).trim();
export const fields=['genre','country','language','provider','cinema','format','rating_rt','rating_audience','rating_imdb','rating_filmaffinity','reviews_rt','duration','start_time','date','certified_fresh'];
const numeric={rating_rt:100,rating_audience:100,rating_imdb:10,rating_filmaffinity:10,reviews_rt:10000000,duration:1440,start_time:1439};
const ops=['eq','ne','gt','gte','lt','lte','in'];
export const emptyIntent=()=>({text:'',conditions:[],semantic_query:'',sort:'soonest',unsupported:[]});
export const conditionId=({field,op,value})=>field+':'+op+':'+fold(value);
const esc=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const comparison=value=>({'>':'gt','>=':'gte','≥':'gte','<':'lt','<=':'lte','≤':'lte','=':'eq','==':'eq'}[value]||(/under|less|below|menos|menys|before|antes|abans/.test(value)?'lt':/at least|minimum|al menos|com a minim|a partir/.test(value)?'gte':'gt'));

export function validateIntent(value,programme){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!Object.keys(emptyIntent()).includes(key)))throw new Error('Invalid search interpretation');
  const result={...emptyIntent(),...value};
  for(const field of ['text','semantic_query'])if(typeof result[field]!=='string'||result[field].length>500)throw new Error('Invalid search text');
  if(!['soonest','rating','relevance'].includes(result.sort)||!Array.isArray(result.conditions)||result.conditions.length>20||!Array.isArray(result.unsupported)||result.unsupported.length>5||result.unsupported.some(x=>typeof x!=='string'||x.length>160))throw new Error('Invalid search interpretation');
  const venues=new Set(programme?.cinemas.map(c=>c.id)||[]);
  const providers=new Set(programme?.films.flatMap(f=>f.sessions.map(s=>fold(s.provider)))||[]);
  const formats=new Set(programme?.films.flatMap(f=>f.sessions.flatMap(s=>(s.formats||[]).map(fold)))||[]);
  result.conditions=result.conditions.map(c=>{
    if(!c||Object.keys(c).some(k=>!['field','op','value'].includes(k))||!fields.includes(c.field)||!ops.includes(c.op)||typeof c.value!=='string'||!c.value||c.value.length>150)throw new Error('Invalid search condition');
    if(c.field in numeric){
      if(c.op==='in'||!/^\d+(?:\.\d+)?$/.test(c.value)||Number(c.value)>numeric[c.field])throw new Error('Invalid numeric condition');
    }else if(c.field==='date'){
      if(!/^\d{4}-\d{2}-\d{2}$/.test(c.value)||!Number.isFinite(Date.parse(c.value))||new Date(c.value+'T12:00Z').toISOString().slice(0,10)!==c.value||c.op==='in')throw new Error('Invalid date condition');
    }else if(c.field==='certified_fresh'){
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

export function parseIntent(text,{programme,exactTitle=false,protectedNames=[]}={}){
  const plan={...emptyIntent(),text};
  if(exactTitle||!text.trim())return plan;
  if(/\b(?:from|made in|produced in|de|produidas? a|producidas? en) (?:catalunya|cataluna|catalonia|catalon[ia]+)\b/.test(fold(text))){
    // Country and audio metadata cannot establish regional production origin.
    plan.unsupported.push('origin:Catalunya');return plan;
  }
  // Keep operators until parsed. The ordinary keyword normalizer strips > and <.
  let rest=String(text).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[’'·]/g,' ');
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
  let changed=false;
  const add=(field,op,value)=>{plan.conditions.push({field,op,value:String(value)});changed=true;};
  const consume=(pattern,callback)=>{rest=rest.replace(pattern,(...args)=>{callback(...args);return ' ';});};
  consume(/\b(?:(not|no|without|sin|sense)\s+)?(?:certified\s+fresh|certificado\s+fresh|certificada\s+fresh|certificat\s+fresh)\b/g,(_,negative)=>add('certified_fresh','eq',negative?'false':'true'));
  const ratingNames='rt(?:\\s+(?:critics|critica|critics score))?|rotten\\s+tomatoes|tomatometer|imdb|film\\s*affinity|fa|rt\\s+audience|audience|popcornmeter|publico|public';
  consume(new RegExp('\\b('+ratingNames+')\\s*(>=|<=|>|<|≥|≤|==|=|above|over|under|at least|more than|less than|mas de|menos de|mes de|menys de)\\s*(\\d+(?:[.,]\\d+)?)\\s*(?:%|/\\s*(?:10|100))?','g'),(_,name,op,n)=>{
    const field=/audience|popcorn|public/.test(name)?'rating_audience':name==='imdb'?'rating_imdb':/affinity|^fa$/.test(name)?'rating_filmaffinity':'rating_rt';
    add(field,comparison(op),n.replace(',','.'));
  });
  consume(/\b(?:good reviews|well[ -]reviewed|highly rated|critically acclaimed|buenas criticas|bien valoradas|mejores criticas|bones critiques|ben valorades)\b/g,()=>{
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
  // Specific origin/audio phrases avoid the old "French" language/origin ambiguity.
  for(const field of ['country','language']){
    const values=new Set([...(dictionaries[field]||[]).flat(),...(programme?.films.flatMap(f=>f.details?.[field==='country'?'countries':'languages']||[])||[])]);
    for(const name of [...values].sort((a,b)=>b.length-a.length)){
      if(fold(name).length<3)continue;
      const prefix=field==='country'?'(?:from|made in|produced in|de|producidas? en|producides? a)':'(?:in|spoken in|audio in|en|audio en)';
      consume(new RegExp('\\b(?:(not|no|without|sin|sense)\\s+)?'+prefix+'\\s+'+esc(fold(name))+'\\b','g'),(_,negative)=>add(field,negative?'ne':'eq',canonical(field,name)));
    }
  }
  for(const row of dictionaries.genre){
    const names=row.map(fold).sort((a,b)=>b.length-a.length).map(esc).join('|');
    consume(new RegExp('\\b(?:(not|no|without|sin|sense)\\s+)?(?:'+names+')\\b','g'),(_,negative)=>add('genre',negative?'ne':'eq',row[0]));
  }
  // Chain and venue words can combine with structured constraints and semantics.
  if(programme){
    const providers=[...new Set(programme.films.flatMap(f=>f.sessions.map(s=>s.provider).filter(Boolean)))].sort((a,b)=>b.length-a.length);
    const selected=[];
    for(const provider of providers){
      if(protectedNames.some(name=>(' '+fold(name)+' ').includes(' '+fold(provider)+' ')))continue;
      consume(new RegExp('\\b'+esc(fold(provider))+'\\b','g'),()=>{selected.push(provider);});
    }
    if(selected.length>1&&/\b(?:or|o)\b/.test(fold(text)))add('provider','in',selected.join('|'));
    else for(const provider of selected)add('provider','eq',provider);
    for(const venue of [...programme.cinemas].sort((a,b)=>(b.short||b.name||'').length-(a.short||a.name||'').length)){
      const name=fold(venue.short||venue.name);if(name.length<3)continue;
      consume(new RegExp('\\b'+esc(name)+'\\b','g'),()=>add('cinema','eq',venue.id));
    }
    const formats=[...new Set(programme.films.flatMap(f=>f.sessions.flatMap(s=>s.formats||[])))];
    for(const format of formats)consume(new RegExp('\\b'+esc(fold(format))+'\\b','g'),()=>add('format','eq',format));
  }
  if(changed){
    rest=rest.replace(/\b(?:show me|find me|looking for|i want|i d like|quiero ver|quiero|busco|vull veure|vull|busca|recomiendame|recomana m|movies?|films?|peliculas?|pelis|pel licules|cinema|with|and|or|at|the|a|an|some|con|y|o|en|el|la|los|las|un|una|unes|uns|amb|i|al|a les|a las)\b/g,' ');
    plan.text=rest.replace(/\s+/g,' ').trim();
    for(const [token,original] of protectedText)plan.text=plan.text.replaceAll(token,original);
  }
  return plan;
}

export function effectiveIntent(plan,ignored=[]){
  return {...plan,conditions:plan.conditions.filter(c=>!ignored.includes(conditionId(c))),semantic_query:ignored.includes('semantic')?'':plan.semantic_query};
}

const compare=(actual,op,wanted)=>({eq:()=>actual===wanted,ne:()=>actual!==wanted,gt:()=>actual>wanted,gte:()=>actual>=wanted,lt:()=>actual<wanted,lte:()=>actual<=wanted}[op]?.()??false);
function textMatch(values,c){
  if(!values.length)return false; // Unknown metadata cannot satisfy a positive or negative condition.
  const actual=values.map(v=>fold(canonical(c.field,v)));
  const wanted=c.value.split('|').map(v=>fold(canonical(c.field,v)));
  return c.op==='ne'?wanted.every(v=>!actual.includes(v)):wanted.some(v=>actual.includes(v));
}
export function ratingValue(film,field){
  const key={rating_rt:'rotten_tomatoes',reviews_rt:'rotten_tomatoes',rating_imdb:'imdb',rating_filmaffinity:'filmaffinity'}[field];
  const rating=field==='rating_audience'?film.ratings?.rotten_tomatoes?.audience:film.ratings?.[key];
  const value=field==='reviews_rt'?rating?.count:rating?.score;
  return typeof value==='number'&&Number.isFinite(value)?value:null;
}
export function matchesConditions(film,session,conditions){
  return conditions.every(c=>{
    let value;
    if(c.field.startsWith('rating_')||c.field==='reviews_rt')value=ratingValue(film,c.field);
    else if(c.field==='duration')value=film.details?.runtime_minutes??film.runtime_minutes;
    else if(c.field==='start_time'){
      const time=session.time||session.starts_at?.match(/T(\d\d:\d\d)/)?.[1];
      value=/^\d\d:\d\d$/.test(time||'')?Number(time.slice(0,2))*60+Number(time.slice(3,5)):null;
    }else if(c.field==='date')return Boolean(session.date)&&compare(session.date,c.op,c.value);
    else if(c.field==='certified_fresh'){
      value=film.ratings?.rotten_tomatoes?.certified_fresh;
      return typeof value==='boolean'&&compare(value,c.op,c.value==='true');
    }else{
      const values=c.field==='genre'?film.details?.genres:c.field==='country'?film.details?.countries:
        c.field==='language'?(session.language?String(session.language).split(/[,;|/]+/).map(x=>x.trim()).filter(Boolean):film.details?.language_status?.state==='conflict'?[]:film.details?.languages):
        c.field==='provider'?[session.provider].filter(Boolean):c.field==='cinema'?[session.cinema_id]:session.formats;
      return textMatch(values||[],c);
    }
    return typeof value==='number'&&Number.isFinite(value)&&compare(value,c.op,Number(c.value));
  });
}

export function intentChips(plan,language='en',programme){
  const words={en:{genre:'Genre',country:'From',language:'Language',provider:'Cinema chain',cinema:'Cinema',format:'Format',duration:'Length',start_time:'Starts',date:'Date',reviews_rt:'RT reviews',not:'Not',semantic:'Theme',rating_rt:'RT critics',rating_audience:'RT audience',rating_imdb:'IMDb',rating_filmaffinity:'FilmAffinity'},es:{genre:'Género',country:'De',language:'Idioma',provider:'Cadena',cinema:'Cine',format:'Formato',duration:'Duración',start_time:'Empieza',date:'Fecha',reviews_rt:'Reseñas RT',not:'Sin',semantic:'Tema',rating_rt:'RT crítica',rating_audience:'RT público',rating_imdb:'IMDb',rating_filmaffinity:'FilmAffinity'},ca:{genre:'Gènere',country:'De',language:'Idioma',provider:'Cadena',cinema:'Cinema',format:'Format',duration:'Durada',start_time:'Comença',date:'Data',reviews_rt:'Ressenyes RT',not:'Sense',semantic:'Tema',rating_rt:'RT crítica',rating_audience:'RT públic',rating_imdb:'IMDb',rating_filmaffinity:'FilmAffinity'}}[language]||{};
  const symbols={eq:'',ne:words.not,gt:'>',gte:'≥',lt:'<',lte:'≤',in:''};
  const chips=plan.conditions.map(c=>{
    let value=c.value.replaceAll('|',' / ');
    if(c.field==='cinema')value=programme?.cinemas.find(v=>v.id===c.value)?.short||value;
    if(c.field==='start_time')value=String(Math.floor(Number(c.value)/60)).padStart(2,'0')+':'+String(Number(c.value)%60).padStart(2,'0');
    if(c.field==='duration')value+=' min';
    if(['rating_rt','rating_audience'].includes(c.field))value+='%';
    if(c.field==='certified_fresh')return {id:conditionId(c),label:((c.value==='false')!==(c.op==='ne')?words.not+' ':'')+'Certified Fresh'};
    if(['genre','country','language'].includes(c.field)&&typeof Intl.DisplayNames==='function'&&c.field==='language'){
      const row=dictionaries.language.find(r=>r[0]===canonical('language',c.value));
      if(row?.[1]?.length===2)value=new Intl.DisplayNames([language],{type:'language'}).of(row[1]);
    }
    return {id:conditionId(c),label:[words[c.field]||c.field,symbols[c.op],value].filter(Boolean).join(' ')};
  });
  if(plan.semantic_query)chips.push({id:'semantic',label:words.semantic+': '+plan.semantic_query});
  return chips;
}
