import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {buildCatalogue,isVerifiedSuggestion} from '../static/search-catalogue.js';
import {madridDate} from '../static/cinema-search.js';
import {buildInterestSuggestions} from './search-interest-suggestions.mjs';
import {createInterestService} from './search-interest-service.mjs';
import {createCompletionService} from './search-completion.mjs';

export function createSearchSuggestions({getProgramme,cacheDirectory='.site/search-cache',completionOptions={},interestOptions={},now=Date.now}={}){
  let cached,building,seenProgramme,programmeVersion;
  const interest=createInterestService({getProgramme,path:resolve(cacheDirectory,'search-interest.json'),now,...interestOptions});
  async function getCatalogue(){
    const programme=await getProgramme(),snapshot=interest.getSnapshot();
    if(seenProgramme!==programme){seenProgramme=programme;programmeVersion=createHash('sha256').update(JSON.stringify(programme)).digest('hex').slice(0,20);}
    const version=programmeVersion+':'+madridDate(now())+':'+(snapshot?.to||'evergreen');
    if(cached?.version===version)return cached;
    if(building?.version===version)return building.promise;
    const promise=(async()=>{
      const cat=await buildCatalogue(programme,now()),suggestions=await buildInterestSuggestions(cat,snapshot,now());
      cat.idea_details=suggestions.entries;cat.ideas=suggestions.entries.map(row=>row.query);
      const extra=suggestions.entries.filter(row=>row.source==='interest'&&!row.requires_location&&!cat.precomputed.some(r=>r.query===row.query))
        .map(row=>({...row,kind:'query',entity_id:null,category:'interest',source:'precomputed',aliases:[]}));
      cat.precomputed.push(...extra);cat.context.verified_searches.push(...extra.map(row=>row.query));
      cat.version=version;cat.programme_version=version.split(':')[0];
      if(seenProgramme===programme)cached=cat;return cat;
    })().finally(()=>{if(building?.version===version)building=null;});
    building={version,promise};return promise;
  }
  const completion=createCompletionService({getCatalogue,...completionOptions});
  return {
    start:()=>interest.start(),stop:()=>interest.stop(),complete:completion.complete,
    async isPrecomputedQuery(query,programme){const cat=await getCatalogue();return cat.programme===programme&&isVerifiedSuggestion([...cat.precomputed,...cat.idea_details],query,{now:now()});},
    async catalogue(){const cat=await getCatalogue();return {entities:cat.entities,precomputed:cat.precomputed,ideas:cat.ideas,idea_details:cat.idea_details,day:cat.context.today,
      version:cat.version,programme_version:cat.programme_version,generated_at:cat.programme.generated_at};},
    status:()=>({interest:interest.status(),completion:completion.status()})
  };
}
