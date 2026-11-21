// Shared with the browser: one chip per subject, even after randomising.
export function chooseChips(entries,{previous=[],seen=new Set(),random=Math.random,initial=false,now=Date.now(),preferredLanguages=[]}={}){
  const available=entries.map((row,i)=>({row,i})).filter(({row})=>!row.valid_until||row.valid_until>now);
  let fresh=available.filter(({row})=>!seen.has(row.query));
  // Complete a rotation before resetting it. Keep the current chips out of
  // the next draw, even at the cycle boundary.
  if(!fresh.length){seen.clear();fresh=available;}
  let pool=fresh.filter(({i})=>!previous.includes(i));
  if(!initial)for(let i=pool.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[pool[i],pool[j]]=[pool[j],pool[i]];}
  const chosen=[],groups=new Set();
  const pick=predicate=>{const match=pool.find(({row})=>!groups.has(row.group||row.query)&&predicate(row));
    if(match){chosen.push(match.i);groups.add(match.row.group||match.row.query);pool=pool.filter(item=>item!==match);}};
  if(initial){
    for(const language of preferredLanguages){pick(row=>row.source==='interest'&&row.kind==='film'&&row.audio_language===language);if(chosen.length)break;}
    if(!chosen.length)pick(row=>row.source==='interest'&&row.kind==='film');
    pick(row=>row.source==='interest'&&row.kind==='cinema');
  }
  if(initial&&chosen.length<3){
    const represented=new Set(chosen.map(i=>entries[i].audio_language));
    const priorities=[...preferredLanguages.filter(l=>!represented.has(l)),...preferredLanguages.filter(l=>represented.has(l))];
    for(const language of priorities){pick(row=>row.audio_language===language);if(chosen.length===3)break;}
  }
  while(chosen.length<3){const length=chosen.length;pick(()=>true);if(chosen.length===length)break;}
  for(const i of chosen)seen.add(entries[i].query);
  return chosen;
}
