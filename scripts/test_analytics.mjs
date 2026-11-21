import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';

const source=readFileSync(new URL('../static/analytics.js',import.meta.url),'utf8').replace(/^export /gm,'');
function setup({hostname='vobarna.com',dnt='0',gpc=false,storage=new Map(),blocked=false,search='?q=private-search',readyState='complete',idle=null}={}){
  const events=[],captures=[],scripts=[],window=new EventTarget();let config;
  window.posthog={init(token,options){assert.match(token,/^phc_/);config=options;options.loaded({capture(name,properties,captureOptions){captures.push(captureOptions);events.push(options.before_send({event:name,properties}));}});}};
  const location={hostname,origin:'https://'+hostname,pathname:'/en/',search,hash:''};
  const localStorage={setItem(k,v){if(blocked)throw Error('Blocked');storage.set(k,v);},getItem:k=>storage.get(k),removeItem:k=>storage.delete(k)};
  const document=Object.assign(new EventTarget(),{documentElement:{lang:'en'},referrer:'https://example.com/private?q=secret',readyState,
    createElement:()=>({}),head:{append:script=>scripts.push(script)}});
  const context=vm.createContext({window,location,localStorage,document,navigator:{doNotTrack:dnt,globalPrivacyControl:gpc},URL,URLSearchParams,
    ...(idle?{requestIdleCallback:callback=>idle.push(callback)}:{})});
  vm.runInContext(source,context);
  return {events,captures,scripts,window,document,location,context,get config(){return config;},emit(name,detail){const event=new Event(name);event.detail=detail;window.dispatchEvent(event);}};
}
test('production analytics queues handoffs and tracks path changes without search text',()=>{
  const app=setup();assert.equal(app.scripts.length,1);
  app.emit('vobarna:ticket-click',{film_id:'film1',screening_id:'session1',cinema_id:'verdi',destination:'cinema.example',placement:'dialog',booking_url:'https://cinema.example/private'});
  assert.equal(app.events.length,0);app.scripts[0].onload();
  assert.equal(app.config.cookieless_mode,'never');assert.equal(app.config.person_profiles,'never');
  assert.equal(app.config.persistence,'localStorage');assert.equal(app.config.disable_persistence,false);
  assert.equal(app.events[0].properties.visitor_alert_version,1);
  assert.equal(app.events[0].properties.visitor_identity_persisted,true);
  assert.equal(app.config.autocapture,false);assert.equal(app.config.disable_session_recording,false);
  assert.equal(app.config.capture_pageleave,true);assert.equal(app.config.capture_pageview,false);
  assert.equal(app.config.enable_recording_console_log,false);
  assert.equal(app.config.session_recording.maskAllInputs,true);
  assert(app.config.session_recording.blockSelector.includes('#locationStatus'));
  assert(app.config.session_recording.blockSelector.includes('.card-distance'));
  const masked=app.config.session_recording.maskCapturedNetworkRequestFn({name:'https://vobarna.com/en/?q=private#secret'});
  assert.equal(masked.name,'https://vobarna.com/en/');
  assert.deepEqual(app.events.map(event=>event.event),['$pageview','ticket_click']);
  assert.equal(app.events[0].properties.$referrer,'https://example.com');
  assert.equal(app.events[0].properties.$current_url,'https://vobarna.com/en/');
  assert.equal(app.events[0].properties.page_type,'home');
  assert.equal(app.events[0].properties.analytics_version,2);
  assert.ok(Number.isFinite(app.captures[0].timestamp.getTime()));
  assert.equal(app.events[1].properties.booking_url,undefined);
  app.location.pathname='/en/films/dune/';app.emit('vobarna:navigation');app.emit('vobarna:navigation');
  assert.equal(app.events.filter(event=>event.event==='$pageview').length,2);
  assert.equal(app.events.at(-1).properties.page_type,'film');
  app.emit('vobarna:search',{scope:'cinemas',query_length:6,result_count:2,query:'secret'});
  assert.equal(app.events.at(-1).properties.query,undefined);
  assert.equal(app.events.at(-1).properties.query_length,6);
  assert.equal(app.events.at(-1).properties.has_results,true);
  const cleaned=app.config.before_send({event:'$web_vitals',properties:{$initial_current_url:'https://vobarna.com/en/?q=secret#screening-1',$initial_referrer:'https://search.example/path?q=secret',$search_keyword:'secret'}});
  assert.equal(cleaned.properties.$initial_current_url,'https://vobarna.com/en/');
  assert.equal(cleaned.properties.$initial_referrer,'https://search.example');
  assert.equal(cleaned.properties.$search_keyword,undefined);
});
test('analytics waits for the page to load and keeps earlier events',()=>{
  const idle=[],app=setup({readyState:'loading',idle});
  app.emit('vobarna:ticket-click',{film_id:'film1',screening_id:'session1',cinema_id:'verdi',destination:'cinema.example',placement:'dialog'});
  assert.equal(app.scripts.length,0);
  app.window.dispatchEvent(new Event('load'));
  assert.equal(app.scripts.length,0);assert.equal(idle.length,1);
  idle[0]();assert.equal(app.scripts.length,1);
  app.scripts[0].onload();
  assert.deepEqual(app.events.map(event=>event.event),['$pageview','ticket_click']);
});
test('local previews and browser privacy preferences do not load analytics',()=>{
  for(const options of [{hostname:'127.0.0.1'},{hostname:'localhost'},{hostname:'origin.vobarna.com'},{dnt:'1'},{dnt:'yes'},{gpc:true}])assert.equal(setup(options).scripts.length,0);
});
test('internal marking persists across pages and can be cleared',()=>{
  const storage=new Map();
  for(const [search,expected] of [['?internal=1',true],['',true],['?internal=0',false],['',false]]){
    const app=setup({storage,search});app.scripts[0].onload();
    assert.equal(app.events[0].properties.internal_user,expected);
  }
});
test('blocked storage falls back to memory and leaves identity unclassified',()=>{
  const app=setup({blocked:true});app.scripts[0].onload();
  assert.equal(app.config.persistence,'memory');assert.equal(app.config.disable_persistence,true);
  assert.equal(app.events[0].properties.visitor_identity_persisted,false);
});
test('SDK-generated events inherit internal and page context and keep native leave metrics',()=>{
  const app=setup({search:'?internal=1'});app.scripts[0].onload();
  app.location.pathname='/ca/cinemes/verdi/';app.document.documentElement.lang='ca';
  const leave=app.config.before_send({event:'$pageleave',properties:{
    $current_url:'https://vobarna.com/ca/cinemes/verdi/?q=secret#private',
    $prev_pageview_duration:12.5,$prev_pageview_max_scroll_percentage:.8
  }});
  assert.equal(leave.properties.internal_user,true);
  assert.equal(leave.properties.visitor_identity_persisted,true);
  assert.equal(leave.properties.page_type,'cinema');
  assert.equal(leave.properties.language,'ca');
  assert.equal(leave.properties.$current_url,'https://vobarna.com/ca/cinemes/verdi/');
  assert.equal(leave.properties.$prev_pageview_duration,12.5);
  assert.equal(leave.properties.$prev_pageview_max_scroll_percentage,.8);
});
test('language and restored documents count once; filter, fragment and ordinary pageshow do not',()=>{
  const app=setup();app.scripts[0].onload();
  app.location.search='?q=private';app.location.hash='#showtimes';app.emit('vobarna:navigation');app.emit('popstate');
  app.emit('pageshow');assert.equal(app.events.length,1);
  app.location.pathname='/es/';app.document.documentElement.lang='es';
  app.emit('vobarna:languagechange');app.emit('vobarna:navigation');
  assert.equal(app.events.length,2);assert.equal(app.events.at(-1).properties.language,'es');
  const restored=new Event('pageshow');restored.persisted=true;app.window.dispatchEvent(restored);
  assert.equal(app.events.length,3);
  assert.equal(app.events.at(-1).properties.restored_from_bfcache,true);
  const restoredView=app.config.before_send({event:'$pageview',properties:{restored_from_bfcache:true,
    $pageview_id:'new',$prev_pageview_id:'ended',$prev_pageview_duration:100}});
  assert.equal(restoredView.properties.$prev_pageview_duration,undefined);
  assert.equal(restoredView.properties.$pageview_id,'new');
});
test('smart-search metrics send only aggregate fields',()=>{
  const app=setup();app.scripts[0].onload();
  app.emit('vobarna:smart-search',{outcome:'unavailable',duration_ms:120,query_length:30,cache_hit:false,
    query:'private-address',intent:{location_query:'private-address'},latitude:41,longitude:2,error:'private-error'});
  const event=app.events.at(-1);
  assert.equal(event.event,'smart_search_completed');assert.equal(event.properties.outcome,'unavailable');
  assert.equal(event.properties.duration_ms,120);assert.equal(event.properties.query_length,30);
  for(const key of ['query','intent','latitude','longitude','error'])assert.equal(event.properties[key],undefined);
});
