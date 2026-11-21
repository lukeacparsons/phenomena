// Shared with the browser: one chip per subject, even after randomising.
export function chooseChips(entries,{previous=[],seen=new Set(),random=Math.random,initial=false,now=Date.now()}={}){
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
    pick(row=>row.source==='interest'&&row.kind==='film');
    pick(row=>row.source==='interest'&&row.kind==='cinema');
  }
  while(chosen.length<3){const length=chosen.length;pick(()=>true);if(chosen.length===length)break;}
  for(const i of chosen)seen.add(entries[i].query);
  return chosen;
}
