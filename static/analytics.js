// Public, write-only project token for the separate VO Barna organisation.
const PROJECT_TOKEN='phc_AUvZfww2dcEvkZ5CBuUdZxRBDCCfqxWXpVquA8eDbf27';
const API_HOST='https://us.i.posthog.com';

export function analyticsPageType(pathname){
  const parts=pathname.split('/').filter(Boolean);
  if(!parts.length||parts.length===1&&['en','es','ca'].includes(parts[0]))return 'home';
  const section=parts[1];
  if(['films','peliculas','pellicules'].includes(section))return parts.length>2?'film':'film_index';
  if(['cinemas','cines','cinemes'].includes(section))return parts.length>2?'cinema':'cinema_index';
  if(['guides','guias','guies'].includes(section))return parts.length>2?'guide':'guide_index';
  if(['about','acerca-de','sobre-nosaltres'].includes(section))return 'about';
  return 'other';
}

export function visitorContext(){
  const internal=new URLSearchParams(location.search).get('internal');
  try{
    // Use local storage only; blocked storage must not fall back to cookies.
    localStorage.setItem('vobarna-storage-check','1');
    localStorage.removeItem('vobarna-storage-check');
    if(internal==='0')localStorage.removeItem('vobarna-internal');
    else if(internal==='1')localStorage.setItem('vobarna-internal','1');
    return {persisted:true,internal:localStorage.getItem('vobarna-internal')==='1'};
  }catch{return {persisted:false,internal:internal==='1'};}
}

export function sanitizeAnalyticsEvent(event){
  if(!event?.properties)return event;
  const properties={...event.properties};
  // Search inputs can contain arbitrary text. Never send query strings,
  // fragments, full referrer paths, or automatically derived search keywords.
  for(const [key,value] of Object.entries(properties)){
    if(/search|keyword/i.test(key)){delete properties[key];continue;}
    if(/url|referrer/i.test(key)&&typeof value==='string'){
      try{const url=new URL(value);properties[key]=/referrer/i.test(key)?url.origin:url.origin+url.pathname;}
      catch{delete properties[key];}
    }
  }
  return {...event,properties};
}

if(['vobarna.com','www.vobarna.com'].includes(location.hostname)
    &&!['1','yes'].includes(navigator.doNotTrack)&&!navigator.globalPrivacyControl){
  const visitor=visitorContext();
  let client=null;
  const queued=[];
  const pageProperties=()=>({site:'vobarna',language:document.documentElement.lang,
    analytics_version:2,page_type:analyticsPageType(location.pathname),
    visitor_alert_version:1,visitor_identity_persisted:visitor.persisted,internal_user:visitor.internal,
    $current_url:location.origin+location.pathname,$pathname:location.pathname,
    $referrer:document.referrer?new URL(document.referrer).origin:''});
  function capture(event,properties={}){
    const value={...pageProperties(),...properties};
    const options={timestamp:new Date()};
    if(client)client.capture(event,value,options);
    else if(queued.length<40)queued.push([event,value,options]);
  }
  window.addEventListener('vobarna:ticket-click',({detail})=>capture('ticket_click',{
    film_id:detail.film_id,screening_id:detail.screening_id,cinema_id:detail.cinema_id,
    destination:detail.destination,placement:detail.placement
  }));
  window.addEventListener('vobarna:screening-open',({detail})=>capture('screening_open',{
    film_id:detail.film_id,screening_id:detail.screening_id,placement:detail.placement
  }));
  window.addEventListener('vobarna:search',({detail})=>capture('search_results',{
    scope:detail.scope,query_length:detail.query_length,result_count:detail.result_count,
    screening_count:detail.screening_count,cinema_count:detail.cinema_count,has_date_filter:detail.has_date_filter,
    has_query:detail.query_length>0,has_results:detail.result_count>0
  }));
  window.addEventListener('vobarna:smart-search',({detail})=>capture('smart_search_completed',{
    outcome:detail.outcome,duration_ms:detail.duration_ms,query_length:detail.query_length,
    semantic_result_count:detail.semantic_result_count,unsupported_count:detail.unsupported_count,
    cache_hit:detail.cache_hit
  }));
  // Only explicit, useful actions; never link text, arbitrary form values or
  // operator URL paths (which can contain booking/session identifiers).
  document.addEventListener('click',event=>{
    const choice=event.target.closest?.('.lang-switch a[hreflang], .lang-switch button[data-lang]');
    const language=choice?.hreflang||choice?.dataset.lang;
    if(['en','es','ca'].includes(language)&&language!==document.documentElement.lang){
      capture('language_switch',{from_language:document.documentElement.lang,to_language:language});
    }
  },true);
  function outbound(event){
    if(event.type==='auxclick'&&event.button!==1)return;
    const anchor=event.target.closest?.('a[href]');
    if(!anchor||anchor.matches('a.ticket-link,a.buyrow-ticket'))return;
    let url;try{url=new URL(anchor.href);}catch{return;}
    if(!['https:','http:'].includes(url.protocol)||['vobarna.com','www.vobarna.com'].includes(url.hostname))return;
    capture('outbound_click',{destination:url.hostname,
      placement:anchor.closest('footer')?'footer':anchor.closest('header')?'header':'content'});
  }
  document.addEventListener('click',outbound,true);
  document.addEventListener('auxclick',outbound,true);
  // Manual views avoid counting every filter query as another page visit.
  let lastPath=location.pathname;
  capture('$pageview');
  function navigation(){
    if(lastPath!==location.pathname){lastPath=location.pathname;capture('$pageview');}
  }
  window.addEventListener('popstate',navigation);
  window.addEventListener('vobarna:navigation',navigation);
  window.addEventListener('vobarna:languagechange',navigation);
  // A restored document does not re-run this module. Start a fresh view so
  // its next leave isn't attributed to time spent on another page.
  window.addEventListener('pageshow',event=>{
    if(event.persisted){lastPath=location.pathname;capture('$pageview',{restored_from_bfcache:true});}
  });
  const script=document.createElement('script');
  script.src='https://us-assets.i.posthog.com/static/array.js';
  script.async=true;script.crossOrigin='anonymous';
  script.onload=()=>{
    window.posthog?.init(PROJECT_TOKEN,{
      api_host:API_HOST,defaults:'2026-08-30',cookieless_mode:'never',person_profiles:'never',
      persistence:visitor.persisted?'localStorage':'memory',disable_persistence:!visitor.persisted,
      cross_subdomain_cookie:false,respect_dnt:true,
      // Native leaves flush with sendBeacon and supply duration/scroll depth.
      // SPA views carry those same $prev_pageview_* properties themselves.
      autocapture:false,capture_pageview:false,capture_pageleave:true,
      capture_dead_clicks:false,rageclick:false,capture_heatmaps:false,capture_webmcp:false,
      disable_session_recording:false,enable_recording_console_log:false,
      session_recording:{
        maskAllInputs:true,
        // Search summaries can repeat typed text; booking links contain operator URLs.
        blockSelector:'#filterChips, #searchStatus, #locationStatus, .card-distance, a.ticket-link, a.buyrow-ticket, a[href*="?q="], a[href*="&q="]',
        recordHeaders:false,recordBody:false,
        maskCapturedNetworkRequestFn:request=>{
          if(!request.name)return request;
          try{const url=new URL(request.name);return {...request,name:url.origin+url.pathname};}
          catch{return null;}
        }
      },
      disable_surveys:true,advanced_disable_feature_flags:true,
      capture_exceptions:false,capture_performance:{web_vitals:true,network_timing:false},
      // SDK-generated leaves and Web Vitals need the same internal-user,
      // identity and page context as our explicit events.
      before_send:event=>{
        const properties={...pageProperties(),...event.properties};
        // The previous view already ended at pagehide. The SDK still retains
        // it in a restored document; don't count time spent in the back cache.
        if(event.event==='$pageview'&&properties.restored_from_bfcache){
          for(const key of Object.keys(properties))if(key.startsWith('$prev_pageview_'))delete properties[key];
        }
        return sanitizeAnalyticsEvent({...event,properties});
      },
      loaded:posthog=>{client=posthog;for(const [event,properties,options] of queued.splice(0))client.capture(event,properties,options);}
    });
  };
  // Analytics availability never gates the programme or booking links, and
  // its download waits until the page's own artwork and scripts have loaded.
  // Events raised in the meantime stay in the queue above.
  const start=()=>document.head.append(script);
  if(document.readyState==='complete')start();
  else window.addEventListener('load',()=>{
    if(typeof requestIdleCallback==='function')requestIdleCallback(start,{timeout:3000});
    else setTimeout(start,200);
  },{once:true});
}
