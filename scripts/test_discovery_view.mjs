import test from 'node:test';
import assert from 'node:assert/strict';
import {discoveryGroups,discoveryTotals} from '../static/discovery-view.js';
import {createListingView,HOME_CARD_PREVIEW} from '../static/listing-view.js';

const session=(id,date='2026-11-21',cinema_id='a')=>({id,date,cinema_id,time:'20:00',starts_at:date+'T20:00:00+01:00'});
const data={films:[{id:'film',title:'Film',urls:{en:'/en/films/film/'},sessions:[session('old','2026-11-19'),session('english'),session('french'),session('tomorrow','2026-11-22'),session('other-cinema','2026-11-21','b')]}],groups:{english:[{id:'film',sessions:['old','english','tomorrow','other-cinema']}],other:[{id:'film',sessions:['french']}]}};
const now=Date.parse('2026-11-21T10:00:00Z');
test('guide filters narrow exact publisher selections without admitting other sessions',()=>{
  const groups=discoveryGroups(data,{now,date:'2026-11-21',cinema:'a'});
  assert.deepEqual(groups.english[0].sessions.map(s=>s.id),['english']);
  assert.deepEqual(groups.other[0].sessions.map(s=>s.id),['french']);
  assert.deepEqual(discoveryTotals(groups),{films:1,sessions:2});
  assert.deepEqual(discoveryGroups(data,{now,date:'2026-12-01'}).english,[]);
});
test('expired sessions disappear and totals count unique films and sessions across sections',()=>{
  const groups=discoveryGroups({...data,groups:{...data.groups,repeated:data.groups.english}},{now});
  assert.deepEqual(groups.english[0].sessions.map(s=>s.id),['english','tomorrow','other-cinema']);
  assert.deepEqual(discoveryTotals(groups),{films:1,sessions:4});
});
test('shared card preview is bounded while its remaining count covers the complete scope',()=>{
  const film={id:'many',title:'Many',urls:{en:'/en/films/many/'},sessions:Array.from({length:100},(_,i)=>session('s'+i))};
  const view=createListingView({language:'en',cinemas:[{id:'a',name:'A',short:'A'}],today:'2026-11-21',...HOME_CARD_PREVIEW});
  const html=view.bodyMarkup(film);
  assert.equal((html.match(/class="card-showtime/g)||[]).length,3);
  assert.match(html,/97 more showtimes/);
  assert.equal(film.sessions.length,100);
});
