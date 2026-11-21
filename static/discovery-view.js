// Selection is supplied by the publisher. Filters can only narrow those sessions.
export function discoveryGroups(data, {now=Date.now(), date='all', cinema=''}={}) {
  const films=new Map(data.films.map(film=>[film.id,film]));
  return Object.fromEntries(Object.entries(data.groups).map(([group,entries])=>[group,
    entries.flatMap(entry=>{
      const film=films.get(entry.id), ids=new Set(entry.sessions);
      if(!film)return [];
      const sessions=film.sessions.filter(session=>ids.has(session.id)&&Date.parse(session.starts_at)>now&&
        (date==='all'||session.date===date)&&(!cinema||session.cinema_id===cinema));
      return sessions.length?[{...film,title:entry.title||film.title,sessions}]:[];
    })
  ]));
}

export function discoveryTotals(groups) {
  const films=new Set(),sessions=new Set();
  for(const group of Object.values(groups))for(const film of group){
    films.add(film.id);for(const session of film.sessions)sessions.add(session.id);
  }
  return {films:films.size,sessions:sessions.size};
}
