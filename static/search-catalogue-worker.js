import {buildCatalogue} from './search-catalogue.js';

// Offline/scoped catalogue construction must not compete with native typing.
self.onmessage=async({data:{url,cinemaId,now,language}})=>{
  try{
    const response=await fetch(url);if(!response.ok)throw Error('Catalogue unavailable');
    let programme=await response.json();
    if(cinemaId)programme={...programme,cinemas:programme.cinemas.filter(c=>c.id===cinemaId),
      films:programme.films.map(f=>({...f,sessions:f.sessions.filter(s=>s.cinema_id===cinemaId)})).filter(f=>f.sessions.length)};
    const cat=await buildCatalogue(programme,now,{language});
    self.postMessage({language:cat.language,entities:cat.entities,precomputed:cat.precomputed,ideas:cat.ideas,version:programme.generated_at+':'+cat.context.today+':'+cat.language,
      generated_at:programme.generated_at,day:cat.context.today,
      idea_details:cat.precomputed.filter(r=>cat.ideas.includes(r.query)).map(r=>({...r,group:r.query}))});
  }catch{self.postMessage({error:'catalogue_unavailable'});}
};
