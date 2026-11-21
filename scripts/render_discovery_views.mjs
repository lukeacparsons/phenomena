import {readFileSync} from 'node:fs';
import {hydrateProgramme} from '../static/programme-data.js';
import {createListingView,HOME_CARD_PREVIEW} from '../static/listing-view.js';
import {discoveryGroups} from '../static/discovery-view.js';

const {collections,now,today}=JSON.parse(readFileSync(0,'utf8'));
const result={};
for(const [kind,payload] of Object.entries(collections)){
  const data=hydrateProgramme(payload),groups=discoveryGroups(data,{now:Date.parse(now)});
  result[kind]={};
  for(const language of ['en','es','ca']){
    const view=createListingView({language,cinemas:data.cinemas,today,...HOME_CARD_PREVIEW});
    result[kind][language]={dates:view.datesMarkup(data.films),groups:Object.fromEntries(
      Object.entries(groups).map(([key,films])=>[key,films.map(film=>({id:film.id,body:view.bodyMarkup(film)}))]))};
  }
}
process.stdout.write(JSON.stringify(result));
