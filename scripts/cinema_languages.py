"""Fill missing original-language facts from exact cinema film pages.

These are film-level facts, not a licence to change another venue's audio,
subtitles or original-version qualification. Pages keep separate provenance.
"""
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import datetime, timezone, timedelta
import argparse
import json
from pathlib import Path
import re
from urllib.parse import urlsplit, parse_qs

from cinesa_showtimes import atomic_write
from film_identity import parse_source, source_urls, keys, titles
from film_details import Document, filter_language_aliases
from original_audio import LANGUAGE_NAMES
from language_evidence import FIELDS, session_reports, resolve, review_report, normalise, invalid_legacy_cinema_report, repair_legacy_cinema_languages

VERSION=5
ROOT=Path(__file__).resolve().parents[1]


def needs_cinema_languages(details):
    return (not details.get('languages') or bool(details.get('language_provenance'))
            or bool(details.get('language_selection')) or bool(details.get('language_reports')))


def urls_for(film, reviewed):
    identities=[film['id'],*film.get('merged_ids',[])]
    if film.get('imdb_id'):identities.append('imdb:'+film['imdb_id'])
    urls=[url for identity in identities for url in reviewed.get(identity,[])]+source_urls(film)
    return list(dict.fromkeys(url for url in urls if urlsplit(url).scheme=='https'))[:8]


def page_facts(html):
    facts=parse_source(html)
    # Match the actual page heading or original-title field, not a title in
    # its navigation, weekly programme or related-film recommendations.
    headings=[re.sub(r'\s*\(VO[A-Z. ]*\)\s*$', '', node.text(),flags=re.I)
              for node in Document(html).root.find('h1')]
    facts['page_titles']=list(dict.fromkeys([*facts['titles'],*headings]))
    identities=[]
    for link in Document(html).root.find('a'):
        url=urlsplit(link.attrs.get('href',''))
        if url.hostname=='euromus.cultura.gencat.cat' and '/filmoteca/' in url.path:
            query=parse_qs(url.query)
            if query.get('codiActiv') and query.get('codiCicle'):
                identities.append(query['codiActiv'][0]+':'+query['codiCicle'][0])
    facts['filmoteca_ids']=list(dict.fromkeys(identities))
    return facts


def matches(film,facts):
    exact_booking=any(s.get('provider')=='filmoteca' and str(s.get('film_id')) in facts.get('filmoteca_ids',[])
                      for s in film.get('sessions',[]))
    if not exact_booking and not keys(titles(film)).intersection(keys(facts.get('page_titles',[]))):return False
    directors=film.get('details',{}).get('directors',[])
    if directors and facts.get('directors') and not keys(directors).intersection(keys(facts['directors'])):return False
    runtime=film.get('details',{}).get('runtime_minutes') or film.get('runtime_minutes')
    if runtime and facts.get('runtimes') and not any(abs(runtime-r)<=max(5,runtime*.05) for r in facts['runtimes']):return False
    # A cinema's advertised release year can be a later local release. It is
    # not imported here and cannot overwrite the verified original year.
    return True


def fresh(record,now):
    try:return timedelta(0)<=now-datetime.fromisoformat(record['checked_at'])<timedelta(hours=24)
    except (ValueError,KeyError):return False


def enrich(data,output,fetch,now,*,force=False,reviewed=None,discover_sources=False,use_tmdb=False,tmdb_get=None):
    output=Path(output)
    manifest=output/'cinema-languages.json'
    if reviewed is None:reviewed=json.loads(Path(__file__).with_name('cinema_language_sources.json').read_text())
    try:previous=json.loads(manifest.read_text())
    except (OSError,ValueError):previous={}
    # Retain successful facts on a parser upgrade if the refresh is unavailable.
    records=dict(previous.get('pages',{}))
    # A failed refresh may retain valid older sources, but never known-bad
    # CineBaix legend claims from an earlier parser.
    records={url:record for url,record in records.items()
             if not invalid_legacy_cinema_report({'source':'cinema','source_url':url,
                                                  'parser_version':record.get('parser_version',0)})}
    previous_films=previous.get('films',{})
    for film in data['films']:
        repair_legacy_cinema_languages(film,now)
        if film.get('details',{}).get('languages'):
            previous_films.setdefault(film['id'],{k:deepcopy(film['details'][k]) for k in FIELDS if k in film['details']})
    native={}
    if discover_sources:
        from language_sources import discover
        native,_=discover(data['films'],output,fetch,now,force=force)
    targets=[]
    for film in data['films']:
        details=film.get('details') or {}
        if not needs_cinema_languages(details):continue
        urls=urls_for(film,reviewed)
        targets.append((film,urls))
    urls=list(dict.fromkeys(url for _,urls in targets for url in urls))
    jobs=[url for url in urls if force or previous.get('version')!=VERSION
          or records.get(url,{}).get('status') not in ('ok','unmatched') or not fresh(records[url],now)]
    def retrieve(url):
        old=records.get(url,{})
        try:
            body=fetch(url)
            facts=page_facts(body.decode('utf-8','replace') if isinstance(body,bytes) else body)
            return url,{'facts':facts,'status':'ok' if facts['page_titles'] else 'unmatched','checked_at':now.isoformat(),'parser_version':VERSION}
        except Exception as error:
            return url,{**old,'status':'stale' if old.get('facts') else 'unavailable',
                        'attempted_at':now.isoformat(),'error':type(error).__name__}
    with ThreadPoolExecutor(max_workers=3) as pool:
        for url,record in pool.map(retrieve,jobs):records[url]=record
    tmdb={'status':'disabled','films':{}}
    if use_tmdb:
        from tmdb_languages import enrich as enrich_tmdb
        identity_facts={}
        for film,urls in targets:
            if film.get('imdb_id'):continue
            for url in urls:
                facts=records.get(url,{}).get('facts',{})
                if not matches(film,facts):continue
                item=identity_facts.setdefault(film['id'],{'titles':titles(film),'directors':[],'years':[],
                                                         'runtimes':[],'sources':[]})
                for field in ('titles','directors','years','runtimes'):
                    item[field]=list(dict.fromkeys(item[field]+facts.get(field,[])))
                item['titles']=list(dict.fromkeys(facts.get('page_titles',[])+item['titles']))
                item['sources'].append(url)
        tmdb=enrich_tmdb(data['films'],output,now,force=force,get=tmdb_get,source_facts=identity_facts)
    filled=0
    for film,urls in targets:
        details=film.setdefault('details',{})
        old=next((previous_films[k] for k in [film['id'],*film.get('merged_ids',[])] if k in previous_films),{})
        reports=[r for r in details.get('language_reports',[]) if r.get('source') in
                 ('rotten_tomatoes','wikidata','filmaffinity','reviewed')]
        for r in reports:
            r.setdefault('evidence','catalogue_language_list' if r['source']=='wikidata' else 'explicit_original_language')
        reports.extend(native.get(film['id'],[]))
        reports.extend(session_reports(film))
        provenance=[]
        for url in urls:
            record=records.get(url,{})
            facts=record.get('facts',{})
            if not matches(film,facts):continue
            if not facts.get('languages') and not facts.get('language_raw'):continue
            names=[LANGUAGE_NAMES[code] for code in facts.get('languages',[]) if code in LANGUAGE_NAMES]
            report={'source':'cinema','source_url':url,'languages':names,
                    'parser_version':record.get('parser_version',0),
                    'raw':facts.get('language_raw') or names,'unknown':facts.get('language_unknown',[]),
                    'checked_at':record['checked_at'],'status':record['status'],
                    'evidence':'original_version_audio' if facts.get('language_evidence')==['original_version_audio'] else 'explicit_original_language'}
            reports.append(report);provenance.append(report)
        extra=tmdb['films'].get(film.get('imdb_id'),{}) or tmdb['films'].get('source:'+film['id'],{})
        if extra.get('codes'):
            reports.append(extra)
            details['spoken_languages']=extra.get('spoken_languages',[])
            if extra.get('identity_evidence'):
                details['language_identity']={k:extra[k] for k in ('imdb_id','tmdb_id','identity_evidence')}
                if not film.get('imdb_id') and re.fullmatch(r'tt\d{7,10}',extra.get('imdb_id') or ''):
                    film['imdb_id']=extra['imdb_id']
        # A source outage must not erase previously supported facts. Preserve
        # their actual observation date, and expose the stale state for review.
        if not any(normalise(r)['complete'] for r in reports):
            reports.extend({**r,'status':'stale'} for r in old.get('language_reports',[]))
        if not details.get('languages') and old.get('languages'):
            details['languages']=old['languages']
            details['language_selection']=old.get('language_selection',{})
        prior_aliases=details.get('search_aliases',[])
        resolve(details,reports,now)
        details['language_provenance']=provenance
        details['search_aliases']=filter_language_aliases(details,[*prior_aliases,*details['languages']])
        sources=[r for r in details.get('sources',[]) if r.get('name')!='cinema_language']
        details['sources']=sources+[{'name':'cinema_language','url':p['source_url'],
                                    'checked_at':p['checked_at'],'status':p['status']} for p in provenance]
        filled+=bool(provenance)
    review=review_report(data['films'],previous_films,now,tmdb_status=tmdb['status'])
    atomic_write(output/'language-review.json',review)
    saved={key:{k:deepcopy(f['details'][k]) for k in FIELDS if k in f.get('details',{})}
           for f in data['films'] if f.get('details') for key in [f['id'],*f.get('merged_ids',[])]}
    result={'version':VERSION,'checked_at':now.isoformat(),'pages':records,'films':saved,
            'films_with_cinema_languages':filled,'requested_pages':len(jobs),
            'coverage':{k:v for k,v in review.items() if k not in ('queue','by_provider')},
            'has_failures':any(records[u]['status'] in ('stale','unavailable') for u in urls)
                or any(r.get('status') in ('stale','unavailable') for r in tmdb['films'].values())}
    atomic_write(manifest,result)
    return result


def refresh(path,fetch,now,*,force=False,discover_sources=False,use_tmdb=False):
    data=json.loads(path.read_text())
    result=enrich(data,path.parent,fetch,now,force=force,discover_sources=discover_sources,use_tmdb=use_tmdb)
    updates={key:f for f in data['films'] if f.get('details',{}).get('language_status')
             for key in [f['id'],*f.get('merged_ids',[])]}
    from programme_store import update_programme
    def merge_languages(latest):
        for film in latest['films']:
            extra=next((updates[k] for k in [film['id'],*film.get('merged_ids',[])] if k in updates),None)
            if not extra:continue
            details=film.setdefault('details',{})
            for key in FIELDS:
                if key in extra['details']:details[key]=deepcopy(extra['details'][key])
                else:details.pop(key,None)
            details['search_aliases']=filter_language_aliases(details,[*details.get('search_aliases',[]),*details['languages']])
            if extra.get('language_source_urls'):film['language_source_urls']=extra['language_source_urls']
            if not film.get('imdb_id') and extra.get('details',{}).get('language_identity'):
                if re.fullmatch(r'tt\d{7,10}',extra.get('imdb_id') or ''):film['imdb_id']=extra['imdb_id']
        latest['generated_at']=now.isoformat()
        from film_grouping import deduplicate_programme
        deduplicate_programme(latest)
        return latest
    latest=update_programme(path,merge_languages)
    review=review_report(latest['films'],result['films'],now,tmdb_status=result['coverage']['tmdb'])
    review['regressions']=list(dict.fromkeys(result['coverage']['regressions']+review['regressions']))
    atomic_write(path.parent/'language-review.json',review)
    result['coverage']={k:v for k,v in review.items() if k not in ('queue','by_provider')}
    atomic_write(path.parent/'cinema-languages.json',result)
    return result


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-dir',type=Path,default=ROOT/'static/preview-data')
    parser.add_argument('--force',action='store_true')
    args=parser.parse_args()
    from curl_cffi import requests
    def fetch(url):
        response=requests.get(url,impersonate='chrome',timeout=25)
        response.raise_for_status()
        if response.status_code!=200:raise ValueError('Incomplete cinema page')
        return response.content
    result=refresh(args.output_dir/'screenings.json',fetch,datetime.now(timezone.utc),force=args.force,discover_sources=True,use_tmdb=True)
    print(json.dumps({k:v for k,v in result.items() if k not in ('pages','films')}))


if __name__=='__main__':main()
