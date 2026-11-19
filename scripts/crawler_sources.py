"""Source isolation: one unavailable operator cannot stop other catalogues."""
from datetime import timezone
import json
import re
from cinesa_showtimes import CinesaClient, ChromeTransport, collect as collect_cinesa
from catalogue_sources import (A1, MADRID, collect_a1, collect_renoir, collect_filmoteca,
    collect_zumzeig, collect_texas, collect_malda, collect_filmax, collect_ateneu)
from cultural_catalogues import collect_institut, collect_caixaforum, collect_elizalde, collect_programme_monitor
from nearby_catalogues import SHOP_VENUES, collect_cinema_shop, collect_cinebaix, collect_capri, collect_ocine_magic
from explore_premium_showtimes import mooby_sessions, yelmo_sessions
from kinepolis_showtimes import build_report as splau_report, fetch_html
from original_audio import original_language_registry, language_code
from crawler_health import LEGACY_GROUPS


def collect_mooby(http, now, languages):
    pages=[];failed=[];first_error=None
    for venue in ('aribau','balmes','bosque','arenas','glories','sarria'):
        url='https://www.moobycinemas.com/'+venue
        try:pages.append((url,http.get(url)))
        except Exception as error:
            failed.append(venue)
            if first_error is None:first_error=error
    if not pages:raise first_error
    # Every venue page carries the shared programme; the extra pages primarily
    # fill artwork. A failed artwork page must not take six catalogues offline.
    for url,html in pages:
        try:
            rows=mooby_sessions(html,[body for _,body in pages],premium_only=False,
                                original_only=True,all_cinemas=True,original_languages=languages)
            for row in rows:
                row['source_url']=url
                if row.get('price_data'):row['price_data']['source_url']=url
            return {'provider':'mooby','fetched_at':now.isoformat(),'sessions':rows,
                    'coverage':{'programme_source_url':url,'unavailable_pages':failed}}
        except (ValueError,KeyError,TypeError) as error:
            if first_error is None:first_error=error
    raise first_error


def collect_sources(http,run,*,nearby_only=False):
    now=run.now
    def basic(provider,rows,**extra):return {'provider':provider,'fetched_at':now.isoformat(),'sessions':rows,**extra}
    def cinesa(venue):
        transport=ChromeTransport()
        try:return collect_cinesa(CinesaClient(transport,venue=venue),now.astimezone(MADRID).date(),None,now,premium_only=False,original_only=True)
        finally:transport.close()
    yelmo_payload=None
    def yelmo(venue):
        nonlocal yelmo_payload
        if yelmo_payload is None:
            response=http.session.post('https://yelmocines.es/now-playing.aspx/GetNowPlaying',json={'cityKey':'barcelona'},timeout=30)
            if response.status_code in (403,429):
                yelmo_payload=json.loads(http._relay_get('https://yelmocines.es/now-playing.aspx/GetNowPlaying'))
            else:
                response.raise_for_status();yelmo_payload=response.json()
        rows,warnings=yelmo_sessions(yelmo_payload,premium_only=False,original_only=True,venue=venue)
        if warnings:raise ValueError('Unverified Yelmo date boundary')
        return basic('yelmo',rows)
    if not nearby_only:
        # Original-language facts remain valid across schedule refreshes. Reuse
        # only previously verified, single-language IMDb metadata when an A1
        # endpoint is unavailable; never infer it from a translated film title.
        languages={}
        for film in (run.previous or {}).get('films',[]):
            values=film.get('details',{}).get('languages',[])
            imdb=film.get('imdb_id')
            state=film.get('details',{}).get('language_status',{}).get('state')
            if (state not in ('conflict','catalogue_only','unresolved') and
                    re.fullmatch(r'tt\d{7,10}',imdb or '') and len(values)==1 and language_code(values[0])):
                languages[imdb]=language_code(values[0])
        payloads={}
        for provider,base in A1.items():
            def a1(provider=provider,base=base):
                payload=http.json(base+'/api/get-events');payloads[provider]=payload
                return collect_a1(provider,payload,http,now)
            run.collect(LEGACY_GROUPS[provider],a1)
        languages.update(original_language_registry(payloads.values()))
        run.collect(LEGACY_GROUPS['mooby'],lambda:collect_mooby(http,now,languages))
        run.collect(['yelmo-maquinista'],lambda:yelmo('westfield-la-maquinista'))
        for venue in ('diagonal-mar','la-farga','diagonal','som-multiespai'):
            run.collect(['cinesa-'+venue],lambda venue=venue:cinesa(venue))
        run.collect(['kinepolis-splau'],lambda:splau_report(fetch_html(),now.astimezone(MADRID).date(),None,now,premium_only=False,original_only=True))
        def phenomena():
            from build_cinema_preview import phenomena_sessions, PHENOMENA_API
            payload=http.json(PHENOMENA_API+'/data.json')
            return basic('phenomena',phenomena_sessions(payload,original_only=True),fetched_at=payload.get('_meta',{}).get('scraped_at'))
        run.collect(['phenomena'],phenomena)
        for provider,collector in [('renoir',collect_renoir),('filmoteca',collect_filmoteca),('zumzeig',collect_zumzeig),
            ('texas',collect_texas),('malda',collect_malda),('filmax',lambda h,n:collect_filmax(h,n,languages)),('ateneu',collect_ateneu)]:
            run.collect(LEGACY_GROUPS[provider],lambda collector=collector:collector(http,now))
    for cinema in SHOP_VENUES:
        run.collect([cinema],lambda cinema=cinema:collect_cinema_shop(http,now,cinema))
    for cinema,collector in [('cinebaix',collect_cinebaix),('cinema-capri',collect_capri),('ocine-magic',collect_ocine_magic)]:
        run.collect([cinema],lambda collector=collector:collector(http,now))
    run.collect(['cinesa-barnasud'],lambda:cinesa('barnasud'))
    for venue,cinema in [('premium-castelldefels','yelmo-castelldefels'),('premium-sant-cugat','yelmo-sant-cugat')]:
        run.collect([cinema],lambda venue=venue:yelmo(venue))
    for cinema,collector in [('institut-francais',collect_institut),('caixaforum-barcelona',collect_caixaforum),('casa-elizalde',collect_elizalde)]:
        run.collect([cinema],lambda collector=collector:collector(http,now))
    for cinema in ('cccb','centre-cultural-albareda','can-carol'):
        run.collect([cinema],lambda cinema=cinema:collect_programme_monitor(http,now,cinema))
