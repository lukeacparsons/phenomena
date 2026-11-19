// Expand repeated canonical URLs in memory; keep the downloaded/cached JSON small.
export function hydrateProgramme(programme){
  return {...programme,films:programme.films.map(film=>({...film,sessions:film.sessions.map(session=>
    session.anchor&&film.urls?{...session,urls:Object.fromEntries(Object.entries(film.urls).map(([language,url])=>[language,url+session.anchor]))}:session
  )}))};
}
