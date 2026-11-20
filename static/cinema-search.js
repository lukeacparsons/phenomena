import {parseDateQuery} from './search-dates.js';
import {parseIntent,effectiveIntent,matchesConditions,ratingValue} from './search-intent.js';
import {filmSynopses} from './film-search-content.js';

export const normalise = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
export const emptySearch = () => ({query:'',date_from:null,date_to:null,cinema_ids:[],formats:[],big_screens_only:false,ignored_filters:[]});
export const matchesFilmId = (film,id) => film.id===id || (film.merged_ids||[]).includes(id);
const madridDateFormatter=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'});
export const madridDate = (now=Date.now()) => madridDateFormatter.format(new Date(now));
export const validDate = value => typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value+'T12:00:00Z')) && new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;

export function inputError(message,code='invalid_input'){
  return Object.assign(new Error(message),{code});
}

export function validateObject(input,keys){
  if(!input||typeof input!=='object'||Array.isArray(input))throw inputError('Arguments must be an object.');
  const unknown=Object.keys(input).filter(key=>!keys.includes(key));
  if(unknown.length)throw inputError('Unknown arguments: '+unknown.join(', '));
}

export function validateSearch(input,programme,index){
  validateObject(input,Object.keys(emptySearch()));
  const filters={...emptySearch(),...input};
  if(typeof filters.query!=='string'||filters.query.length>500)throw inputError('query must be a string of at most 500 characters.');
  for(const field of ['date_from','date_to']){
    if(filters[field]!==null&&!validDate(filters[field]))throw inputError(field+' must be a valid YYYY-MM-DD date or null.');
  }
  if(filters.date_from&&filters.date_to&&filters.date_to<filters.date_from)throw inputError('date_to must be on or after date_from.');
  if(typeof filters.big_screens_only!=='boolean')throw inputError('big_screens_only must be a boolean.');
  if(!Array.isArray(filters.ignored_filters)||filters.ignored_filters.length>20||filters.ignored_filters.some(v=>typeof v!=='string'||v.length>220||!v))throw inputError('Invalid ignored search filters.');
  const known=index?.known||{cinema_ids:programme.cinemas.map(cinema=>cinema.id),formats:[...new Set(programme.films.flatMap(film=>film.sessions.flatMap(session=>session.formats||[])))]};
  for(const field of ['cinema_ids','formats']){
    if(!Array.isArray(filters[field])||filters[field].length>20||filters[field].some(value=>typeof value!=='string'||!value||value.length>128))throw inputError(field+' must contain at most 20 strings.');
    filters[field]=[...new Set(filters[field].map(value=>{
      const match=known[field].find(candidate=>normalise(candidate)===normalise(value));
      if(!match)throw inputError('Unknown '+field+' value: '+value+'. Use get_context for supported values.');
      return match;
    }))];
  }
  return filters;
}

export function parseFilmQuery(programme,query,today=madridDate(),index){
  const folded=normalise(query);
  const exactTitle=folded&&(index?index.titles.has(folded):programme?.films.some(film=>[film.title,film.original_title,film.english_title,...(film.titles||[])].some(title=>title&&normalise(title)===folded)));
  return exactTitle?{text:query,range:null}:parseDateQuery(query,today);
}

export function resolvedSearch(programme,filters,now=Date.now(),index){
  const parsed=parseFilmQuery(programme,filters.query,madridDate(now),index);
  // Explicit date bounds take precedence over dates embedded in the query.
  const explicit=filters.date_from||filters.date_to;
  return {text:parsed.text,range:explicit?{start:filters.date_from,end:filters.date_to}:parsed.range};
}

const DETAIL_FIELDS=['directors','writers','cast','genres','topics','countries','languages','composers','cinematographers','editors','studios','based_on','source_authors'];
const PEOPLE_FIELDS=['directors','writers','cast','composers','cinematographers','editors','source_authors'];

// Codes are lookup keys for provider metadata, not extra words in the search index.
// Expand the structured fields only: a subtitle/release territory is not a film's origin.
const LANGUAGE_NAMES=[
  ['es spa esp cas','Spanish|español|espanyol|Castilian|castellano|castellà'],
  ['ca cat','Catalan|catalán|català|Valencian|valenciano|valencià'],
  ['en eng ang','English|inglés|anglès'],
  ['fr fra fre','French|francés|francès|français'],
  ['de deu ger','German|alemán|alemany|Deutsch'],
  ['it ita','Italian|italiano|italià'],
  ['pt por','Portuguese|portugués|portuguès|português'],
  ['eu eus baq','Basque|vasco|basc|euskera|euskara'],
  ['gl glg','Galician|gallego|gallec|galego'],
  ['ja jpn','Japanese|japonés|japonès'],
  ['ko kor','Korean|coreano|coreà'],
  ['zh zho chi','Chinese|chino|xinès'],
  ['cmn','Mandarin|mandarín|mandarí'],
  ['yue','Cantonese|cantonés|cantonès'],
  ['hi hin','Hindi|hindí'],
  ['bn ben','Bengali|bengalí'],
  ['ta tam','Tamil|tàmil'],
  ['te tel','Telugu|telugú'],
  ['ur urd','Urdu|urdú'],
  ['ar ara','Arabic|árabe|àrab'],
  ['fa fas per','Persian|persa|Farsi'],
  ['he heb','Hebrew|hebreo|hebreu'],
  ['ru rus','Russian|ruso|rus'],
  ['uk ukr','Ukrainian|ucraniano|ucraïnès'],
  ['pl pol','Polish|polaco|polonès'],
  ['ro ron rum','Romanian|rumano|romanès'],
  ['bg bul','Bulgarian|búlgaro|búlgar'],
  ['el ell gre','Greek|griego|grec'],
  ['tr tur','Turkish|turco|turc'],
  ['nl nld dut','Dutch|neerlandés|neerlandès|holandés|holandès'],
  ['sv swe','Swedish|sueco|suec'],
  ['da dan','Danish|danés|danès'],
  ['no nor nb nob nn nno','Norwegian|noruego|noruec'],
  ['fi fin','Finnish|finés|finlandés|finès'],
  ['is isl ice','Icelandic|islandés|islandès'],
  ['hu hun','Hungarian|húngaro|hongarès'],
  ['cs ces cze','Czech|checo|txec'],
  ['sk slk slo','Slovak|eslovaco|eslovac'],
  ['sr srp','Serbian|serbio|serbi'],
  ['hr hrv','Croatian|croata'],
  ['th tha','Thai|tailandés|tailandès'],
  ['vi vie','Vietnamese|vietnamita'],
  ['id ind','Indonesian|indonesio|indonesi'],
  ['tl tgl fil','Tagalog|Filipino|filipí'],
  ['la lat','Latin|latín|llatí']
];
const languageAliases=new Map(LANGUAGE_NAMES.flatMap(([codes,names])=>
  [...codes.split(' '),...names.split('|')].map(name=>[normalise(name),names.split('|')])));
// The second column adds nationality words. Sharing a language does not make
// countries interchangeable: Spanish audio alone must not imply Spain or Mexico.
const COUNTRY_NAMES=[
  ['Spain|España|Espanya','es'],['Catalonia|Catalunya|Cataluña','ca'],
  ['France|Francia|França','fr'],['Germany|Alemania|Alemanya|Deutschland','de'],
  ['Italy|Italia|Itàlia','it'],['Portugal','pt'],['Japan|Japón|Japó','ja'],
  ['South Korea|Corea del Sur|Corea del Sud|Republic of Korea','ko'],
  ['North Korea|Corea del Norte|Corea del Nord','ko'],
  ["China|People's Republic of China|República Popular China|República Popular de la Xina|Xina",'zh'],
  ['Russia|Rusia|Rússia|Russian Federation','ru'],['Ukraine|Ucrania|Ucraïna','uk'],
  ['Poland|Polonia|Polònia','pl'],['Romania|Rumanía|Rumania|Romanía','ro'],
  ['Bulgaria|Bulgària','bg'],['Greece|Grecia|Grècia','el'],['Turkey|Türkiye|Turquía|Turquia','tr'],
  ['Netherlands|The Netherlands|Países Bajos|Països Baixos|Holland|Holanda','nl'],
  ['Sweden|Suecia|Suècia','sv'],['Denmark|Dinamarca','da'],['Norway|Noruega','no'],
  ['Finland|Finlandia|Finlàndia','fi'],['Iceland|Islandia|Islàndia','is'],['Hungary|Hungría|Hongria','hu'],
  ['Czech Republic|Czechia|República Checa|Chequia|Txèquia','cs'],['Slovakia|Eslovaquia|Eslovàquia','sk'],
  ['Serbia|Sèrbia','sr'],['Croatia|Croacia|Croàcia','hr'],['Thailand|Tailandia|Tailàndia','th'],
  ['Vietnam','vi'],['Indonesia|Indonèsia','id'],['Philippines|Filipinas|Filipines','tl'],
  ['United States|United States of America|USA|U.S.A.|US|U.S.|Estados Unidos|EEUU|EE.UU.|Estats Units|American|estadounidense|estatunidenc'],
  ['United Kingdom|UK|U.K.|Great Britain|Reino Unido|Regne Unit|Gran Bretaña|Gran Bretanya|British|británico|britànic'],
  ['England|Inglaterra','en'],['Scotland|Escocia|Escòcia|Scottish|escocés|escocès'],
  ['Wales|Gales|Gal·les|Welsh|galés|gal·lès'],['Ireland|Irlanda|Irish|irlandés|irlandès'],
  ['Mexico|México|Mèxic|Mexican|mexicano|mexicà'],['Argentina|Argentine|Argentinian|argentino|argentí'],
  ['Chile|Xile|Chilean|chileno|xilè'],['Colombia|Colòmbia|Colombian|colombiano|colombià'],
  ['Brazil|Brasil|Brazilian|brasileño|brasileiro|brasiler'],['Peru|Perú|Peruvian|peruano|peruà'],
  ['Uruguay|Uruguai|Uruguayan|uruguayo|uruguaià'],['Cuba|Cuban|cubano|cubà'],
  ['Canada|Canadá|Canadà|Canadian|canadiense|canadenc'],['Belgium|Bélgica|Bèlgica|Belgian|belga'],
  ['Austria|Àustria|Austrian|austriaco|austríaco|austríac'],['Switzerland|Suiza|Suïssa|Swiss|suizo|suís'],
  ['Australia|Austràlia|Australian|australiano|australià'],['New Zealand|Nueva Zelanda|Nova Zelanda|New Zealander|neozelandés|neozelandès'],
  ['India|Índia|Indian|indio|indi'],['Iran|Irán|Iranian|iraní'],['Israel|Israeli|israelí'],
  ['Hong Kong|Hongkongese|hongkonés|hongkonguès'],['Taiwan|Taiwán|Taiwanese|taiwanés|taiwanès'],
  ['Algeria|Argelia|Algèria|Algerian|argelino|algerià'],['Morocco|Marruecos|Marroc|Moroccan|marroquí'],
  ['Tunisia|Túnez|Tunísia|Tunisian|tunecino|tunisià'],['Egypt|Egipto|Egipte|Egyptian|egipcio|egipci'],
  ['Jordan|Jordania|Jordània|Jordanian|jordano|jordà'],['Lebanon|Líbano|Líban|Lebanese|libanés|libanès'],
  ['Palestine|Palestina|Palestinian|palestino|palestí'],
  ['United Arab Emirates|Emiratos Árabes Unidos|Emirats Àrabs Units|Emirati|emiratí'],
  ['The Gambia|Gambia|Gàmbia|Gambian|gambiano|gambià'],['South Africa|Sudáfrica|Sud-àfrica|South African|sudafricano|sud-africà']
];
const countryAliases=new Map(COUNTRY_NAMES.flatMap(([names,language])=>{
  const aliases=[...names.split('|'),...(languageAliases.get(language)||[])];
  return names.split('|').map(name=>[normalise(name),aliases]);
}));

function languageSearchWords(values){
  return values.flatMap(value=>String(value||'').split(/[,;/|]+/).flatMap(name=>
    [name,...(languageAliases.get(normalise(name))||[])])).join(' ');
}

function searchableAliases(details){
  // Older programme caches include producer names in the shared alias list.
  // Keep a name when the person also has a searchable credit on this film.
  const credited=new Set(PEOPLE_FIELDS.flatMap(field=>details[field]||[]).map(normalise));
  const producerOnly=new Set((details.producers||[]).map(normalise).filter(name=>!credited.has(name)));
  return (details.search_aliases||[]).filter(alias=>!producerOnly.has(normalise(alias)));
}

// Build once for each immutable fetched programme. Callers with mutable data can
// omit the index; queryFilms then builds a fresh one rather than caching stale facts.
export function createSearchIndex(programme){
  const cinemas=new Map(programme.cinemas.map(cinema=>[cinema.id,cinema]));
  const titles=new Set(),people=new Set(),formats=new Set(),providers=new Set();
  const films=programme.films.map(film=>{
    for(const title of [film.title,film.original_title,film.english_title,...(film.titles||[])])if(title)titles.add(normalise(title));
    const title=normalise([film.title,film.original_title,film.english_title,...(film.titles||[]).map(title=>title
      .replace(/\([^)]*\b(?:VOSE|VOSI|ATMOS|IMAX|iSense|Laser ULTRA|4K|35mm|70mm)\b[^)]*\)/gi,' ')
      .replace(/^VOSE\s+/i,''))].join(' '));
    const details=film.details||{};
    const aliases=searchableAliases(details);
    const credits=PEOPLE_FIELDS.flatMap(field=>details[field]||[]).map(normalise);
    credits.forEach(name=>{if(name.includes(' '))people.add(name);});
    const personNames=new Set([...credits,...aliases.map(normalise)]);
    const metadata=normalise([...DETAIL_FIELDS.flatMap(field=>details[field]||[]),...aliases,
      languageSearchWords(details.languages||[]),...(details.countries||[]).flatMap(country=>countryAliases.get(normalise(country))||[]),
      film.release_year,details.release_year,details.runtime_minutes,
      ...(details.release_dates||[]).flatMap(release=>[release.date,release.region])].join(' '));
    const plot=normalise(filmSynopses(film).join(' '));
    const words=[...new Set((title+' '+metadata+' '+plot).split(' ').filter(Boolean))];
    const sessions=film.sessions.map(session=>{
      (session.formats||[]).forEach(format=>formats.add(format));
      const venue=cinemas.get(session.cinema_id);
      const provider=normalise(session.provider);
      if(provider)providers.add(provider);
      // Operator names remain searchable even when a venue uses an unbranded name.
      return {session,starts:Date.parse(session.starts_at),words:normalise([venue?.name,venue?.short,provider,...(session.formats||[]),session.version,languageSearchWords([session.language])].join(' ')).split(' ').filter(Boolean)};
    }).sort((a,b)=>a.starts-b.starts||a.session.id.localeCompare(b.session.id));
    return {film,words,personNames,plot,sessions};
  });
  return {programme,films,titles,people:[...people],providers:[...providers],intents:new Map(),known:{cinema_ids:[...cinemas.keys()],formats:[...formats]}};
}

export function interpretSearch(programme,filters,{now=Date.now(),index,intent}={}){
  const parsed=resolvedSearch(programme,filters,now,index);
  const text=normalise(parsed.text);
  let plan=intent||index?.intents.get(parsed.text);
  if(!plan){
    const protectedNames=index?[...index.people,...[...index.titles].filter(t=>t.includes(' '))].filter(name=>(' '+text+' ').includes(' '+name+' ')):[];
    plan=parseIntent(parsed.text,{programme,exactTitle:index?.titles.has(text),protectedNames});
    if(index){if(index.intents.size>=100)index.intents.delete(index.intents.keys().next().value);index.intents.set(parsed.text,plan);}
  }
  return effectiveIntent(plan,filters.ignored_filters||[]);
}

export function queryFilms(programme,filters,{now=Date.now(),ignoreExplicitDates=false,index,intent,semanticScores}={}){
  if(!programme)return [];
  if(!index||index.programme!==programme)index=createSearchIndex(programme);
  const parsed=resolvedSearch(programme,filters,now,index);
  if(ignoreExplicitDates&&(filters.date_from||filters.date_to))parsed.range=null;
  const plan=interpretSearch(programme,filters,{now,index,intent});
  // Never present the whole catalogue as matches when a requested constraint
  // could not be applied and the model removed its words from the query.
  if(plan.unsupported.length)return [];
  const query=normalise(plan.text);
  const semantic=plan.semantic_query&&semanticScores?new Map(semanticScores.map(row=>[row.film_id,row.score])):null;
  const conditions=plan.conditions.filter(c=>!(c.field==='date'&&(filters.date_from||filters.date_to)));
  const bigScreens=filters.big_screens_only||/\b(?:big screens? only|solo pantallas grandes|nomes pantalles grans)\b/.test(query);
  const terms=query.replace(/\b(?:big screens? only|solo pantallas grandes|nomes pantalles grans)\b/g,' ').split(' ').filter(Boolean);
  const personQueries=index.people.filter(name=>(' '+query+' ').includes(' '+name+' '));
  const titleQueries=[...index.titles].filter(title=>title.includes(' ')&&(' '+query+' ').includes(' '+title+' '));
  const namedTerms=new Set([...personQueries,...titleQueries].flatMap(name=>name.split(' ')));
  // A named operator must match the screening, even if it is also a film studio.
  // Preserve explicit titles and people such as "La vida es Verdi" or "Jean Renoir".
  const providerTerms=new Set(index.providers.filter(name=>(' '+query+' ').includes(' '+name+' ')).flatMap(name=>name.split(' ')));
  const matches=index.films.flatMap(({film,words,personNames,plot,sessions:rows})=>{
    if(semantic&&!semantic.has(film.id))return [];
    if(!personQueries.every(name=>personNames.has(name)||(' '+plot+' ').includes(' '+name+' ')))return [];
    // Match shared film metadata once, then only test remaining terms per session.
    const sessionTerms=terms.filter(term=>(providerTerms.has(term)&&!namedTerms.has(term))||!words.some(word=>word.startsWith(term)));
    const sessions=rows.filter(({session,starts,words:sessionWords})=>{
      if(!(starts>=now))return false;
      if(parsed.range&&((parsed.range.start&&session.date<parsed.range.start)||(parsed.range.end&&session.date>parsed.range.end)))return false;
      if(filters.cinema_ids.length&&!filters.cinema_ids.includes(session.cinema_id))return false;
      if(!filters.formats.every(format=>(session.formats||[]).includes(format)))return false;
      if(bigScreens&&session.big_screen!==true)return false;
      if(!matchesConditions(film,session,conditions))return false;
      return sessionTerms.every(term=>sessionWords.some(word=>word.startsWith(term)));
    }).map(row=>row.session);
    return sessions.length?[{...film,sessions}]:[];
  });
  const floor=semantic?Math.max(.25,...matches.map(f=>semantic.get(f.id)-.12)):0;
  const ratingField=plan.conditions.find(c=>c.field.startsWith('rating_')&&['gt','gte'].includes(c.op))?.field||plan.conditions.find(c=>c.field.startsWith('rating_'))?.field||'rating_rt';
  return matches.filter(f=>!semantic||semantic.get(f.id)>=floor)
    .sort((a,b)=>(semantic?(semantic.get(b.id)||0)-(semantic.get(a.id)||0):plan.sort==='rating'?(ratingValue(b,ratingField)??-1)-(ratingValue(a,ratingField)??-1):0)||Date.parse(a.sessions[0].starts_at)-Date.parse(b.sessions[0].starts_at)||a.title.localeCompare(b.title)||a.id.localeCompare(b.id));
}

export function searchParams(filters,filmId=null,screeningId=null){
  const params=new URLSearchParams();
  if(filters.query)params.set('q',filters.query);
  if(filters.date_from&&filters.date_from===filters.date_to)params.set('date',filters.date_from);
  else{
    if(filters.date_from)params.set('from',filters.date_from);
    if(filters.date_to)params.set('to',filters.date_to);
  }
  for(const id of filters.cinema_ids)params.append('cinemas',id);
  for(const format of filters.formats)params.append('format',format);
  if(filters.big_screens_only)params.set('big','1');
  for(const id of filters.ignored_filters||[])params.append('skip',id);
  if(filmId)params.set('film',filmId);
  if(screeningId)params.set('screening',screeningId);
  return params;
}

export function searchFromURL(params){
  const date=params.get('date');
  return {query:(params.get('q')||'').slice(0,500),date_from:validDate(date)?date:validDate(params.get('from'))?params.get('from'):null,
    date_to:validDate(date)?date:validDate(params.get('to'))?params.get('to'):null,
    cinema_ids:params.getAll('cinemas'),formats:params.getAll('format'),big_screens_only:params.get('big')==='1',ignored_filters:params.getAll('skip').filter(v=>v&&v.length<=220).slice(0,20)};
}
