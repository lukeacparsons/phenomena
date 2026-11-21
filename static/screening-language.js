import {LANGUAGE_LABELS} from './language-labels.js';

const fold=value=>String(value??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
const aliases=new Map(Object.entries(LANGUAGE_LABELS).flatMap(([code,labels])=>[code,...labels.split('|')].map(label=>[fold(label),code])));
const code=value=>aliases.get(fold(value).replace(/^[ ,.;]+|[ ,.;]+$/g,''));
const placeholder=value=>['','otras lenguas','otros idiomas','altres llengues','altres idiomes','other languages','unknown','und'].includes(fold(value));
export const languageRows=Object.entries(LANGUAGE_LABELS).map(([code,labels])=>[labels.split('|')[0],code,...labels.split('|').slice(1)]);
export function parseLanguages(value){
  const codes=[],unknown=[];
  for(const raw of Array.isArray(value)?value:[value]){
    if(!raw)continue;
    const parts=code(raw)?[raw]:String(raw).replace(/^[ .,:;]+|[ .,:;]+$/g,'').split(/\s*[,;/&+|]\s*|\s+(?:y|i|and|et|e)\s+/i);
    for(const part of parts){
      const found=code(part);
      if(found){if(!codes.includes(found))codes.push(found);}
      else if(String(part).trim()&&!unknown.includes(String(part).trim()))unknown.push(String(part).trim());
    }
  }
  return {codes,unknown,complete:codes.length>0&&!unknown.length};
}
export function screeningAudio(film,session){
  if(!placeholder(session.language))return {...parseLanguages(session.language),source_url:session.source_url,derived:false};
  const empty={...parseLanguages(null),source_url:null,derived:false};
  if(session.original_audio===false||!['VO','VOSE','VOSC','VOSI','VOSA'].includes(String(session.version||'').toUpperCase()))return empty;
  const d=film.details||{};
  const reports=(d.language_reports||[]).filter(r=>r.status==='ok'&&r.evidence==='explicit_original_language'&&r.source_url&&r.source_url===session.source_url);
  if(reports.length){
    const parsed=reports.map(r=>parseLanguages(r.languages?.length?r.languages:r.raw));
    if(parsed.every(p=>p.complete&&p.codes.length===parsed[0].codes.length&&p.codes.every(c=>parsed[0].codes.includes(c))))return {...parsed[0],source_url:session.source_url,derived:true};
    return empty;
  }
  const selection=d.language_selection||{};
  if(d.language_status?.state!=='conflict'&&selection.evidence==='explicit_original_language'&&selection.source_url)
    return {...parseLanguages(d.original_languages?.length?d.original_languages:d.languages),source_url:selection.source_url,derived:true};
  return empty;
}
export const hasNonEnglishAudio=audio=>audio.codes.some(code=>!['en','zxx'].includes(code));
export const hasEnglishSubtitles=session=>parseLanguages(session.subtitles).codes.includes('en');
