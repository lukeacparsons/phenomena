const searchProperties={
  query:{type:'string',maxLength:500,description:'English, Spanish or Catalan film/date queries and supported factual constraints: audio, subtitles, production country, credits, cinema, format, numeric ratings, runtime, start/estimated finish time, published admission and fresh seat counts. Audio, subtitles and nationality are distinct: "in English", "English subtitles", "from France". Examples: "IMDb >7.5", "finishes before 22:00", "under €10". search_screenings uses the local parser; AI themes and location resolution require set_search and completion in the visible page.'},
  date_from:{type:['string','null'],description:'Inclusive first screening date, YYYY-MM-DD, in Europe/Madrid. Explicit dates override dates in query.'},
  date_to:{type:['string','null'],description:'Inclusive last screening date, YYYY-MM-DD, in Europe/Madrid. Use the same date_from and date_to for one day.'},
  cinema_ids:{type:'array',items:{type:'string'},maxItems:20,description:'Match any of these cinema IDs from get_context. Empty means all cinemas.'},
  formats:{type:'array',items:{type:'string'},maxItems:20,description:'Require every listed format on the same screening. Use format values from get_context.'},
  big_screens_only:{type:'boolean',description:'Use the curated premium selection, including comfort-focused venues.'},
  ignored_filters:{type:'array',items:{type:'string'},maxItems:20,description:'Search interpretation filters removed by the user. Preserve from get_context when updating an existing view; normally omit.'}
};
const schema=(properties={},required=[])=>({type:'object',properties,required,additionalProperties:false});
const screeningSchema=schema({screening_id:{type:'string',maxLength:256,description:'Exact screening_id returned by search_screenings.'}},['screening_id']);

export function createWebMCPTools(service){
  const definitions=[
    {name:'get_context',description:'Read VO Barna’s current view, supported cinemas and formats, programme coverage and data freshness.',inputSchema:schema()},
    {name:'search_screenings',description:'Search the collected programme with the local factual parser, without changing the page or calling AI/geolocation. Defaults to upcoming original-version screenings; explicit past queries cover retained schedules. Returns paginated sessions in start-time order, with film/screening IDs, cached availability and official booking links. Price and seat filters require sourced, sufficiently fresh evidence; unknowns do not match. AI themes, nearby resolution, sourced venue answers and itinerary presentation are available through the visible page, not this response.',
      inputSchema:schema({...searchProperties,limit:{type:'integer',minimum:1,maximum:50,default:20,description:'Maximum number of sessions to return.'},offset:{type:'integer',minimum:0,maximum:100000,default:0,description:'Result offset; use next_offset to continue. Results are ordered by start time, then screening ID.'}})},
    {name:'get_film',description:'Read a film’s collected credits, original languages, release information and ratings with source URLs and observation dates.',inputSchema:schema({film_id:{type:'string',maxLength:256,description:'Exact film_id returned by search_screenings.'}},['film_id'])},
    {name:'get_screening',description:'Read one screening’s room, format, cached seat counts and official booking destination. Availability includes its timestamp, count kind and staleness.',inputSchema:screeningSchema},
    {name:'set_search',description:'Replace the visible search and filters, close the film dialog, and update the shareable URL. Returns the first 20 local matches immediately. The page may subsequently run AI interpretation, location permission/geocoding and result enrichment; this response does not await those results. Review the resulting visible page for themes, nearby searches, venue answers and outings. Omitted filters are cleared; empty arguments reset the search.',inputSchema:schema(searchProperties),mutates:true},
    {name:'show_screening',description:'Open an upcoming screening in the film dialog and highlight its official ticket link. Updates the shareable URL. If current filters hide this screening, the dialog shows the film’s upcoming sessions. The ticket link leads to the cinema’s booking flow.',inputSchema:screeningSchema,mutates:true}
  ];
  return definitions.map(({mutates=false,...definition})=>({...definition,
    annotations:{readOnlyHint:!mutates,untrustedContentHint:true,consequentialHint:false},
    async execute(input={},options={}){
      try{
        if(options.signal?.aborted)return {ok:false,error:{code:'cancelled',message:'The tool was cancelled before making a change.'}};
        return await service[definition.name](input);
      }catch(error){
        return {ok:false,error:{code:error.code||'operation_failed',message:error.code?error.message:'The operation could not be completed. Read get_context and try again.'}};
      }
    }
  }));
}
