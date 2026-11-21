import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';

const source=readFileSync(new URL('../static/analytics.js',import.meta.url),'utf8').replace(/^export /gm,'');
function setup({hostname='vobarna.com',dnt='0',gpc=false,storage=new Map(),blocked=false,search='?q=private-search',readyState='complete',idle=null}={}){
  const events=[],scripts=[],window=new EventTarget();let config;
  window.posthog={init(token,options){assert.match(token,/^phc_/);config=options;options.loaded({capture(name,properties){events.push(options.before_send({event:name,properties}));}});}};
  const location={hostname,origin:'https://'+hostname,pathname:'/en/',search,hash:''};
  const localStorage={setItem(k,v){if(blocked)throw Error('Blocked');storage.set(k,v);},getItem:k=>storage.get(k),removeItem:k=>storage.delete(k)};
  const context=vm.createContext({window,location,localStorage,navigator:{doNotTrack:dnt,globalPrivacyControl:gpc},URL,URLSearchParams,
    document:{documentElement:{lang:'en'},referrer:'https://example.com/private?q=secret',readyState,
      createElement:()=>({}),head:{append:script=>scripts.push(script)}},
    ...(idle?{requestIdleCallback:callback=>idle.push(callback)}:{})});
  vm.runInContext(source,context);
  return {events,scripts,window,location,context,get config(){return config;},emit(name,detail){const event=new Event(name);event.detail=detail;window.dispatchEvent(event);}};
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
  assert.equal(app.config.enable_recording_console_log,false);
  assert.equal(app.config.session_recording.maskAllInputs,true);
  assert(app.config.session_recording.blockSelector.includes('#locationStatus'));
  assert(app.config.session_recording.blockSelector.includes('.card-distance'));
  const masked=app.config.session_recording.maskCapturedNetworkRequestFn({name:'https://vobarna.com/en/?q=private#secret'});
  assert.equal(masked.name,'https://vobarna.com/en/');
  assert.deepEqual(app.events.map(event=>event.event),['$pageview','ticket_click']);
  assert.equal(app.events[0].properties.$referrer,'https://example.com');
  assert.equal(app.events[0].properties.$current_url,'https://vobarna.com/en/');
  assert.equal(app.events[1].properties.booking_url,undefined);
  app.location.pathname='/en/films/dune/';app.emit('vobarna:navigation');app.emit('vobarna:navigation');
  assert.equal(app.events.filter(event=>event.event==='$pageview').length,2);
  app.emit('vobarna:search',{scope:'cinemas',query_length:6,result_count:2,query:'secret'});
  assert.equal(app.events.at(-1).properties.query,undefined);
  assert.equal(app.events.at(-1).properties.query_length,6);
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
