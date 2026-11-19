// Render all localized listing bodies in one process, using the browser's renderer.
import {readFileSync} from 'node:fs';
import {hydrateProgramme} from '../static/programme-data.js';
import {queryFilms,emptySearch,madridDate,createSearchIndex} from '../static/cinema-search.js';
import {createListingView} from '../static/listing-view.js';
import {TEXT} from '../static/cinema-copy.js';

const {programme,now,limit,cinema_ids}=JSON.parse(readFileSync(0,'utf8'));
const data=hydrateProgramme(programme),views={};
const index=createSearchIndex(data);
for(const id of ['',...cinema_ids]){
  const filters={...emptySearch(),cinema_ids:id?[id]:[]};
  const films=queryFilms(data,filters,{now:Date.parse(now),index});
  for(const language of ['en','es','ca']){
    const view=createListingView({language,cinemas:data.cinemas,today:madridDate(Date.parse(now))});
    views[language+':'+id]={dates:view.datesMarkup(films),total:films.length,
      search:TEXT[language].search,placeholder:TEXT[language].searchPlaceholder,
      cards:films.slice(0,limit).map(film=>({id:film.id,body:view.bodyMarkup(film)}))};
  }
}
process.stdout.write(JSON.stringify(views));
