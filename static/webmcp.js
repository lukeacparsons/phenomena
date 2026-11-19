const searchProperties={
  query:{type:'string',maxLength:500,description:'Film titles, people, genres, languages, countries, cinemas, formats or natural-language dates in English, Spanish or Catalan. Language names also match production nationality. Examples: "Villeneuve this weekend", "espanol IMAX", "French tomorrow".'},
  date_from:{type:['string','null'],description:'Inclusive first screening date, YYYY-MM-DD, in Europe/Madrid. Explicit dates override dates in query.'},
  date_to:{type:['string','null'],description:'Inclusive last screening date, YYYY-MM-DD, in Europe/Madrid. Use the same date_from and date_to for one day.'},
  cinema_ids:{type:'array',items:{type:'string'},maxItems:20,description:'Match any of these cinema IDs from get_context. Empty means all cinemas.'},
  formats:{type:'array',items:{type:'string'},maxItems:20,description:'Require every listed format on the same screening. Use format values from get_context.'},
  big_screens_only:{type:'boolean',description:'Use the curated premium selection, including comfort-focused venues.'}
};
const schema=(properties={},required=[])=>({type:'object',properties,required,additionalProperties:false});
const screeningSchema=schema({screening_id:{type:'string',maxLength:256,description:'Exact screening_id returned by search_screenings.'}},['screening_id']);

export function createWebMCPTools(service){
  const definitions=[
    {name:'get_context',description:'Read VO Barna’s current view, supported cinemas and formats, programme coverage and data freshness.',inputSchema:schema()},
    {name:'search_screenings',description:'Find upcoming original-version screenings in VO Barna’s collected Barcelona-area programme. Returns paginated sessions with film and screening IDs, cached availability and official booking links. Leaves the page unchanged. Omitted filters mean all screenings.',
      inputSchema:schema({...searchProperties,limit:{type:'integer',minimum:1,maximum:50,default:20,description:'Maximum number of sessions to return.'},offset:{type:'integer',minimum:0,maximum:100000,default:0,description:'Result offset; use next_offset to continue. Results are ordered by start time, then screening ID.'}})},
    {name:'get_film',description:'Read a film’s collected credits, original languages, release information and ratings with source URLs and observation dates.',inputSchema:schema({film_id:{type:'string',maxLength:256,description:'Exact film_id returned by search_screenings.'}},['film_id'])},
    {name:'get_screening',description:'Read one screening’s room, format, cached seat counts and official booking destination. Availability includes its timestamp, count kind and staleness.',inputSchema:screeningSchema},
    {name:'set_search',description:'Replace the visible VO Barna search and filters, close the film dialog, and update results and the shareable URL. Returns the first 20 matching sessions. Omitted filters are cleared; empty arguments reset the search.',inputSchema:schema(searchProperties),mutates:true},
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

// Registration errors must never stop the normal page. A failed batch is removed
// using its lifecycle signal; callbacks read current application data on every call.
export async function registerWebMCP(registry,service,{signal,onError=()=>{}}={}){
  if(typeof registry?.registerTool!=='function'||signal?.aborted)return null;
  const lifecycle=new AbortController();
  const abort=()=>lifecycle.abort();
  signal?.addEventListener('abort',abort,{once:true});
  let ready=false;
  try{
    for(const tool of createWebMCPTools(service)){
      await registry.registerTool({...tool,execute:(...args)=>ready&&!lifecycle.signal.aborted?tool.execute(...args):{ok:false,error:{code:'not_ready',message:'The tools are not ready. Try again after page loading completes.'}}},{signal:lifecycle.signal});
      if(lifecycle.signal.aborted)return null;
    }
    ready=true;
    return ()=>{abort();signal?.removeEventListener('abort',abort);};
  }catch(error){
    abort();signal?.removeEventListener('abort',abort);onError(error);
    return null;
  }
}
