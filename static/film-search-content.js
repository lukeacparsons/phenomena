// Use actual story descriptions, including complementary publisher/cinema text.
// Old catalogue caches can contain an SEO description in place of a synopsis.
export function cleanSynopsis(value){
  const text=typeof value==='string'?value.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim():'';
  return /discover reviews,? ratings|stay updated with critic and audience|watch trailers.*read.*reviews/i.test(text)?'':text;
}
export function filmSynopses(film){
  const values=[film.synopsis,...(film.synopses||[]),film.details?.synopsis,...(film.details?.synopses||[]),...(film.sessions||[]).map(s=>s.synopsis)];
  return [...new Set(values.map(cleanSynopsis).filter(Boolean))].slice(0,6).map(text=>text.slice(0,4000));
}
