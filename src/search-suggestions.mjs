import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {buildCatalogue,isVerifiedSuggestion} from '../static/search-catalogue.js';
import {madridDate} from '../static/cinema-search.js';
import {suggestionLanguage} from '../static/search-localization.js';
import {buildInterestSuggestions} from './search-interest-suggestions.mjs';
import {createInterestService} from './search-interest-service.mjs';
import {createCompletionService} from './search-completion.mjs';

export function createSearchSuggestions({getProgramme,cacheDirectory='.site/search-cache',completionOptions={},interestOptions={},now=Date.now}={}){
  const cached=new Map(),building=new Map();let seenProgramme,programmeVersion;
  const interest=createInterestService({getProgramme,path:resolve(cacheDirectory,'search-interest.json'),now,...interestOptions});
  async function getCatalogue(language='en'){
    language=suggestionLanguage(language);
    const programme=await getProgramme(),snapshot=interest.getSnapshot();
    if(seenProgramme!==programme){seenProgramme=programme;cached.clear();programmeVersion=createHash('sha256').update(JSON.stringify(programme)).digest('hex').slice(0,20);}
    const version=programmeVersion+':'+madridDate(now())+':'+(snapshot?.to||'evergreen')+':'+language;
    if(cached.get(language)?.version===version)return cached.get(language);
    if(building.get(language)?.version===version)return building.get(language).promise;
    const promise=(async()=>{
      const cat=await buildCatalogue(programme,now(),{language}),suggestions=await buildInterestSuggestions(cat,snapshot,now());
      cat.idea_details=suggestions.entries;cat.ideas=suggestions.entries.map(row=>row.query);
      const extra=suggestions.entries.filter(row=>!cat.precomputed.some(r=>r.query===row.query))
        .map(row=>({...row,kind:'query',entity_id:null,category:'interest',source:'precomputed',aliases:[]}));
      cat.precomputed.push(...extra);cat.context.verified_searches.push(...extra.map(row=>row.query));
      const matches=cat.matches;cat.matches=(query,at=now())=>isVerifiedSuggestion(cat.idea_details,query,{now:at})||matches(query,at);
      cat.version=version;cat.programme_version=version.split(':')[0];
      if(seenProgramme===programme)cached.set(language,cat);return cat;
    })().finally(()=>{if(building.get(language)?.version===version)building.delete(language);});
    building.set(language,{version,promise});return promise;
  }
  const completion=createCompletionService({getCatalogue,...completionOptions});
  return {
    start:async()=>{await interest.start();await Promise.all(['en','es','ca'].map(getCatalogue));},stop:()=>interest.stop(),complete:completion.complete,
    async isPrecomputedQuery(query,programme,language='en'){const cat=await getCatalogue(language);return cat.programme===programme&&isVerifiedSuggestion([...cat.precomputed,...cat.idea_details],query,{now:now()});},
    async catalogue(language='en'){const cat=await getCatalogue(language);return {language:cat.language,entities:cat.entities,precomputed:cat.precomputed,ideas:cat.ideas,idea_details:cat.idea_details,day:cat.context.today,
      version:cat.version,programme_version:cat.programme_version,generated_at:cat.programme.generated_at};},
    status:()=>({interest:interest.status(),completion:completion.status()})
  };
}
