import {queryFilms,interpretSearch,normalise,emptySearch,searchParams,madridDate} from './cinema-search.js';
import {conditionId,intentChips,matchesConditions} from './search-intent.js';
import {makeItineraries,admissionPrice,observedSeats,estimatedEnd} from './outing-search.js';

const COPY={
 en:{seat_freshness:'Seat filters use recent observations. Counts can change and do not reserve tickets.',itinerary_estimate:'Each plan stays at one cinema. When an end time is not published, we add 20 minutes to the film runtime for trailers and adverts. Breaks between films are shown separately.',travel_time:'Walking, driving and public-transport times are not available. Search by distance or open the cinema’s directions.',invalid_time:'That time is not valid. Try a time such as 21:30.',unknown_reference:'We cannot identify that reference film and its credits. Try its full title or name the director.',ambiguous_reference:'More than one film has that title. Add the release year.',future_programme:'A return screening can only be shown after a cinema publishes it. These are the dates currently collected.',coverage:'The requested dates extend beyond the collected programme. Later screenings may not have been published yet.',history:'Historical results cover retained schedules only. They are not a complete record of every screening.',no_matches:'No collected screenings satisfy all these requirements.',unknown:'We do not have enough verified information for:',together:'adjacent seats; the reported total does not tell us which seats are together',age:'Spanish age classifications; check the official film guidance',content:'absence of the requested content; an omitted warning is not proof of absence',venue:'the requested facility in the actual screening room; consult the sourced venue notes',awards:'the requested award or nomination in the collected credits',events:'the requested event or edition in the published session labels',subs:'confirmed screenings without subtitles',seats:'recent seat availability; check the cinema’s ticket page',prices:'comparable admission prices for these screenings',remove:'Try without',dates:'Try other dates',did_you_mean:'Did you mean',known:'Known film — no matching upcoming screening',venue_heading:'Venue information',plans:'Suggested film outings',source:'Source',checked:'Checked',notes:'Scope and remaining checks',no_plans:'No complete itinerary fits the requested gap and dates.',past:'Past screening — tickets are not offered',preferences:'Preferences affect order; required filters still apply.'},
 es:{seat_freshness:'Los filtros de plazas usan observaciones recientes. Pueden cambiar y no reservan entradas.',itinerary_estimate:'Cada plan es en un mismo cine. Si no se publica la hora de finalización, añadimos 20 minutos a la duración de la película para tráileres y anuncios. Las pausas entre películas se muestran aparte.',travel_time:'No disponemos de tiempos a pie, en coche o en transporte público. Busca por distancia o consulta cómo llegar al cine.',invalid_time:'La hora no es válida. Prueba, por ejemplo, 21:30.',unknown_reference:'No identificamos la película de referencia y sus créditos. Escribe el título completo o el director.',ambiguous_reference:'Hay varias películas con ese título. Añade el año.',future_programme:'Solo podemos mostrar reposiciones cuando el cine publica sus fechas.',coverage:'Las fechas solicitadas superan la programación recopilada. Puede que las sesiones posteriores aún no estén publicadas.',history:'El historial contiene solo horarios conservados, no todas las proyecciones.',no_matches:'Ninguna sesión recopilada cumple todos estos requisitos.',unknown:'No tenemos información verificada suficiente sobre:',together:'asientos contiguos; el total no indica cuáles están juntos',age:'clasificación por edades en España; consulta la guía oficial',content:'ausencia del contenido indicado; que no aparezca una advertencia no confirma su ausencia',venue:'esa instalación en la sala concreta; consulta las notas del cine',awards:'el premio o la nominación solicitados',events:'el evento o la edición en los datos publicados de la sesión',subs:'sesiones confirmadas sin subtítulos',seats:'disponibilidad reciente; consulta la taquilla oficial',prices:'precios de entrada comparables para estas sesiones',remove:'Probar sin',dates:'Probar otras fechas',did_you_mean:'¿Querías decir',known:'Película conocida — sin próximas sesiones coincidentes',venue_heading:'Información del cine',plans:'Planes de cine sugeridos',source:'Fuente',checked:'Consultado',notes:'Alcance y comprobaciones pendientes',no_plans:'No hay un itinerario completo con estas fechas y pausas.',past:'Sesión pasada — no se ofrecen entradas',preferences:'Las preferencias ordenan los resultados; los requisitos siguen siendo obligatorios.'},
 ca:{seat_freshness:'Els filtres de places fan servir observacions recents. Poden canviar i no reserven entrades.',itinerary_estimate:'Cada pla és en un mateix cinema. Si no es publica l’hora de finalització, afegim 20 minuts a la durada de la pel·lícula per a tràilers i anuncis. Les pauses entre pel·lícules es mostren a part.',travel_time:'No disposem de temps a peu, en cotxe o en transport públic. Cerca per distància o consulta com arribar al cinema.',invalid_time:'L’hora no és vàlida. Prova, per exemple, 21:30.',unknown_reference:'No identifiquem la pel·lícula de referència i els seus crèdits. Escriu el títol complet o el director.',ambiguous_reference:'Hi ha diverses pel·lícules amb aquest títol. Afegeix-hi l’any.',future_programme:'Només podem mostrar reposicions quan el cinema en publica les dates.',coverage:'Les dates demanades superen la programació recopilada. Potser les sessions posteriors encara no estan publicades.',history:'L’historial conté només horaris conservats, no totes les projeccions.',no_matches:'Cap sessió recopilada compleix tots aquests requisits.',unknown:'No tenim prou informació verificada sobre:',together:'seients contigus; el total no indica quins són junts',age:'classificació per edats a Espanya; consulta la guia oficial',content:'absència del contingut indicat; una advertència omesa no en confirma l’absència',venue:'aquesta instal·lació a la sala concreta; consulta les notes del cinema',awards:'el premi o la nominació demanats',events:'l’esdeveniment o l’edició en les dades publicades de la sessió',subs:'sessions confirmades sense subtítols',seats:'disponibilitat recent; consulta la taquilla oficial',prices:'preus d’entrada comparables per a aquestes sessions',remove:'Prova sense',dates:'Prova altres dates',did_you_mean:'Volies dir',known:'Pel·lícula coneguda — sense pròximes sessions coincidents',venue_heading:'Informació del cinema',plans:'Plans de cinema suggerits',source:'Font',checked:'Consultat',notes:'Abast i comprovacions pendents',no_plans:'No hi ha cap itinerari complet amb aquestes dates i pauses.',past:'Sessió passada — no s’ofereixen entrades',preferences:'Les preferències ordenen els resultats; els requisits continuen sent obligatoris.'}
};
export const searchCopy=language=>COPY[language]||COPY.en;
const evidenceLabels={en:{reported:'Source report',conflict:'Sources disagree',historical:'Historical source'},es:{reported:'Según la fuente',conflict:'Las fuentes discrepan',historical:'Fuente histórica'},ca:{reported:'Segons la font',conflict:'Les fonts discrepen',historical:'Font històrica'}};
const escapeHTML=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeURL=v=>typeof v==='string'&&/^(https:\/\/|\/(?!\/))/.test(v)?escapeHTML(v):'';
const activeConditions=p=>[...p.conditions,...(p.alternatives||[]).flat()];
const PLAN_COPY={
 en:{ends:'Ends',estimated_end:'Est. end',break:'break',next_day:'next day'},
 es:{ends:'Final',estimated_end:'Final estimado',break:'de pausa',next_day:'día siguiente'},
 ca:{ends:'Final',estimated_end:'Final estimat',break:'de pausa',next_day:'dia següent'}
};

function itineraryMarkup(paths,programme,language){
  const copy=PLAN_COPY[language]||PLAN_COPY.en,e=escapeHTML;
  const locale={en:'en-GB',es:'es-ES',ca:'ca-ES'}[language]||'en-GB';
  const dateFormat=new Intl.DateTimeFormat(locale,{timeZone:'Europe/Madrid',weekday:'short',day:'numeric',month:'short',year:'numeric'});
  const timeFormat=new Intl.DateTimeFormat(locale,{timeZone:'Europe/Madrid',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  return paths.map(path=>{
    const first=path[0],cinema=programme.cinemas.find(c=>c.id===first.session.cinema_id);
    const rows=path.map((row,i)=>{
      const filmURL=safeURL(row.film.urls?.[language]);
      const screeningURL=safeURL(row.session.urls?.[language]||(row.film.urls?.[language]&&row.film.urls[language]+'#screening-'+encodeURIComponent(row.session.id)));
      const publishedEnd=/^https:\/\//.test(row.session.source_url||'')&&Number.isFinite(Date.parse(row.session.ends_at));
      const endDay=madridDate(row.end)!==row.session.date?' · '+copy.next_day:'';
      const time=`<time datetime="${e(row.session.starts_at)}">${e(timeFormat.format(row.start))}</time>`;
      const title=filmURL?`<a class="search-outing-title" href="${filmURL}">${e(row.film.title)}</a>`:`<span class="search-outing-title">${e(row.film.title)}</span>`;
      const gap=i<path.length-1?Math.round((path[i+1].start-row.end)/60000):null;
      const duration=gap===null?'':`${Math.floor(gap/60)?Math.floor(gap/60)+' h ':''}${gap%60||!gap?gap%60+' min':''}`.trim();
      return `<li class="search-outing-stop"><div class="search-outing-film">${screeningURL?`<a class="search-outing-start" href="${screeningURL}">${time}</a>`:`<span class="search-outing-start">${time}</span>`}<div class="search-outing-detail">${title}<p class="search-outing-end">${e(publishedEnd?copy.ends:copy.estimated_end)} <time datetime="${e(new Date(row.end).toISOString())}">${e(timeFormat.format(row.end))}</time>${e(endDay)}</p></div></div>${gap===null?'':`<p class="search-outing-break">${e(duration+' '+copy.break)}</p>`}</li>`;
    }).join('');
    return `<article class="search-outing content-block reading-wash"><div class="search-outing-heading"><h3>${e(cinema?.short||cinema?.name||first.session.cinema_id)}</h3><p><time datetime="${e(first.session.date)}">${e(dateFormat.format(first.start))}</time></p></div><ol role="list">${rows}</ol></article>`;
  }).join('');
}

export function venueAnswers(programme,query,topic){
  const needle=normalise(query),aliases={belongings:['food_belongings'],transport:['timing','accessibility'],seating:['seating'],accessibility:['accessibility'],booking:['booking_help','total_cost']};
  const venues=programme.search?.venues||[];
  const named=venues.filter(v=>[v.name,programme.cinemas.find(c=>c.id===v.id)?.short].some(n=>n&&needle.includes(normalise(n))));
  const terms=needle.split(' ').filter(t=>t.length>3&&!['which','cinemas','cinema','there','have','does','bring','could','would','puedo','llevar','cines','cinemes'].includes(t));
  return (named.length?named:venues).flatMap(v=>{
    const answers=v.answers.filter(a=>(aliases[topic]||[topic]).includes(a.topic));
    const passages=answers.flatMap(a=>a.passages).map(p=>({...p,score:terms.filter(t=>normalise(p.text).includes(t)).length})).sort((a,b)=>b.score-a.score).slice(0,2);
    if(!passages.length||(!named.length&&!passages[0].score))return [];
    return [{...v,passages,unresolved:[...new Set(answers.flatMap(a=>a.unresolved||[]))].slice(0,2),score:passages[0].score}];
  }).sort((a,b)=>b.score-a.score).slice(0,5);
}

function editDistance(a,b){
  let row=Array.from({length:b.length+1},(_,i)=>i);
  for(let i=1;i<=a.length;i++){
    const next=[i];for(let j=1;j<=b.length;j++)next[j]=Math.min(next[j-1]+1,row[j]+1,row[j-1]+(a[i-1]===b[j-1]?0:1));row=next;
  }
  return row[b.length];
}
export function spellingSuggestions(index,text){
  const query=normalise(text);if(query.length<4||query.length>70)return [];
  return [...new Set([...index.titles,...index.people])].filter(v=>Math.abs(v.length-query.length)<=2)
    .map(value=>({value,distance:editDistance(query,value)})).filter(r=>r.distance>0&&r.distance<=(query.length>8?2:1)).sort((a,b)=>a.distance-b.distance||a.value.localeCompare(b.value)).slice(0,3).map(r=>r.value);
}

export function searchFeedback(programme,filters,rows,{index,intent,language='en',now=Date.now(),...context}={}){
  const plan=interpretSearch(programme,filters,{index,intent,now}),copy=searchCopy(language);
  const result={messages:[...new Set((plan.notices||[]).map(n=>copy[n]).filter(Boolean))],suggestions:[],known:[],venues:[],itineraries:makeItineraries(rows,plan.itinerary)};
  if(plan.preferences?.length)result.messages.push(copy.preferences);
  if(plan.scope==='past')result.messages.push(copy.history);
  if(plan.venue_query||activeConditions(plan).some(c=>c.field==='venue_feature'))result.venues=venueAnswers(programme,filters.query,plan.venue_query||'accessibility');
  if(plan.venue_query&&!result.venues.length)result.messages.push(copy.unknown+' '+copy.venue+'.');
  if(rows.length&&!plan.venue_query)return result;
  if(plan.itinerary)result.messages.push(copy.no_plans);
  const fields=new Set(activeConditions(plan).map(c=>c.field));
  for(const [field,key] of [['seats_together','together'],['age_max','age'],['content_warning','content'],['venue_feature','venue'],['has_subtitles','subs'],['award','awards'],['nomination','awards'],['event','events'],['edition','events'],['seats_available','seats'],['price_eur','prices']]){
    if(!fields.has(field))continue;
    const conditions=activeConditions(plan).filter(c=>c.field===field);
    const found=index.films.some(({film,sessions})=>sessions.some(({session,starts})=>starts>=now&&(field==='price_eur'?admissionPrice(session)!==null:field==='seats_available'?observedSeats(session,{...context,now})!==null:conditions.every(c=>matchesConditions(film,session,[c],index.cinemas.get(session.cinema_id),{...context,now})))));
    if(!found)result.messages.push(copy.unknown+' '+copy[key]+'.');
  }
  const future=index.films.flatMap(f=>f.sessions).filter(r=>r.starts>=now).map(r=>r.session.date).sort();
  const date=filters.date_from||plan.conditions.find(c=>c.field==='date'&&['eq','gte','gt'].includes(c.op))?.value;
  if(date&&future.length&&date>future.at(-1))result.messages.push(copy.coverage);
  const needle=normalise(plan.text||filters.query);
  if(needle)result.known=index.films.filter(({film})=>[film.title,film.original_title,film.english_title,...(film.titles||[])].some(t=>normalise(t)===needle)).map(r=>r.film).slice(0,5);
  if(!plan.venue_query&&!plan.unsupported.length&&!plan.notices?.some(n=>['travel_time','invalid_time','unknown_reference','ambiguous_reference'].includes(n))){
    const options={...context,index,now,intent:plan};
    for(const c of plan.conditions.slice(0,12)){
      const next={...filters,ignored_filters:[...filters.ignored_filters,conditionId(c)]};
      const alternatives=queryFilms(programme,next,options);
      if(alternatives.length){result.suggestions.push({label:copy.remove+' '+intentChips({...plan,conditions:[c],alternatives:[],preferences:[],semantic_query:'',itinerary:null},language,programme)[0].label,filters:next,count:alternatives.length});if(result.suggestions.length>=3)break;}
    }
    if(filters.date_from||filters.date_to){const next={...filters,date_from:null,date_to:null};if(queryFilms(programme,next,options).length)result.suggestions.push({label:copy.dates,filters:next});}
    if(!result.suggestions.length&&plan.text&&!plan.conditions.length&&!plan.alternatives?.length)for(const value of spellingSuggestions(index,plan.text))result.suggestions.push({label:copy.did_you_mean+' “'+value+'”?',filters:{...filters,query:value,ignored_filters:[]}});
  }
  if(!result.messages.length&&!result.known.length&&!result.venues.length&&!rows.length&&!plan.venue_query)result.messages.push(copy.no_matches);
  return result;
}

export function feedbackMarkup(result,{language='en',programme,listingPath='/'+language+'/'}={}){
  const copy=searchCopy(language),e=escapeHTML;
  const notes=result.messages.filter(message=>!result.itineraries.length||message!==copy.itinerary_estimate).map(message=>`<p>${e(message)}</p>`).join('');
  const links=result.suggestions.length?`<div class="search-next-actions">${result.suggestions.map(s=>`<a class="text-action" data-search-suggestion href="${safeURL(listingPath+'?'+searchParams(s.filters))}">${e(s.label)}${s.count?' ('+s.count+')':''}</a>`).join('')}</div>`:'';
  const known=result.known.map(f=>`<p><a href="${safeURL(f.urls?.[language])}">${e(f.title)}${f.release_year?' ('+e(f.release_year)+')':''}</a> · ${e(copy.known)}</p>`).join('');
  const venues=result.venues.length?`<div class="search-venue-answers"><h2>${e(copy.venue_heading)}</h2>${result.venues.map(v=>`<article><h3><a href="${safeURL(programme.cinemas.find(c=>c.id===v.id)?.urls?.[language]||v.official_url)}">${e(v.name)}</a></h3>${v.passages.map(p=>`<p>${e(p.text)}</p><p class="search-evidence">${e((evidenceLabels[language]||evidenceLabels.en)[p.conflicting?'conflict':/historical|dated|superseded/.test(p.status||'')?'historical':'reported'])} · ${e(p.scope)} ${p.checked_at?e(copy.checked+': '+p.checked_at):''} ${p.sources.map(s=>`<a href="${safeURL(s.url)}" target="_blank" rel="noopener noreferrer">${e(s.title||copy.source)}</a>`).join(' · ')}</p>`).join('')}<details><summary>${e(copy.notes)}</summary>${v.unresolved.map(n=>`<p>${e(n)}</p>`).join('')}</details></article>`).join('')}</div>`:'';
  const plans=result.itineraries.length?`<div class="search-itineraries"><h2>${e(copy.plans)}</h2><p class="search-itineraries-intro">${e(copy.itinerary_estimate)}</p><div class="search-itineraries-grid">${itineraryMarkup(result.itineraries,programme,language)}</div></div>`:'';
  return notes+links+known+venues+plans;
}
