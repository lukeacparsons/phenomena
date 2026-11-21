// Render every localized film in one process, with the same view as the dialog.
import {readFileSync} from 'node:fs';
import {filmMarkup} from '../static/film-view.js';

const {films,cinemas,now}=JSON.parse(readFileSync(0,'utf8'));
const views={};
for(const film of films){
  views[film.id]={};
  for(const language of ['en','es','ca']){
    views[film.id][language]=filmMarkup(film,{language,cinemas,page:true,now:Date.parse(now),
      poster:'<!--film-poster-->',availabilityPending:false});
  }
}
process.stdout.write(JSON.stringify(views));
