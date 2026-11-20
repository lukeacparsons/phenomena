"""Validate independent source results and merge only accepted cinema catalogues."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import json
import time
from pathlib import Path

from cinesa_showtimes import atomic_write
from crawler_health import coverage_by_cinema, instant
from film_grouping import deduplicate_programme
from catalogue_sources import CatalogueHTTPError
from observation_history import ObservationHistory


class InvalidCatalogue(ValueError):
    pass


def validate_report(report, cinema, previous, now, *, accept_drops=False):
    checked=instant(report.get('fetched_at'))
    if not checked or checked>now+timedelta(minutes=5):raise InvalidCatalogue('invalid_source_timestamp')
    previous_checked=instant(coverage_by_cinema(previous or {}).get(cinema,{}).get('fetched_at'))
    if previous_checked and checked<previous_checked:raise InvalidCatalogue('source_timestamp_rolled_back')
    rows=[];seen={}
    for raw in report['sessions']:
        if raw.get('cinema_id')!=cinema:raise InvalidCatalogue('wrong_cinema')
        item=dict(raw)
        starts=instant(item.get('starts_at'))
        if item.get('starts_at') and not starts:raise InvalidCatalogue('invalid_session_timestamp')
        if not starts and item.get('date') and item.get('time'):
            from catalogue_sources import MADRID
            starts=datetime.fromisoformat(item['date']+'T'+item['time']).replace(tzinfo=MADRID)
        if not starts:raise InvalidCatalogue('invalid_session_timestamp')
        if item.get('original_audio') is not True:raise InvalidCatalogue('original_audio_unverified')
        if not item.get('id') or not item.get('film_id') or not item.get('title'):raise InvalidCatalogue('missing_session_identity')
        if item['id'] in seen and seen[item['id']]!=item:raise InvalidCatalogue('conflicting_duplicate_session')
        if item['id'] in seen:continue
        seen[item['id']]=dict(item)
        if starts<now:continue
        item['starts_at']=starts.isoformat();rows.append(item)
    old=[r for f in (previous or {}).get('films',[]) for r in f['sessions'] if r['cinema_id']==cinema
         and instant(r.get('starts_at')) and now<=instant(r['starts_at'])<=now+timedelta(days=7)]
    near=[r for r in rows if instant(r['starts_at'])<=now+timedelta(days=7)]
    if not accept_drops and old and (not rows or (len(old)>=10 and len(near)<len(old)*.25)):
        raise InvalidCatalogue('suspicious_session_drop')
    return {**report,'cinema_id':cinema,'sessions':rows,'count':len(rows)}


class CrawlRun:
    def __init__(self,output,previous,now,*,accept_drops=False,monotonic=time.monotonic):
        self.output=Path(output);self.previous=previous;self.now=now;self.accept_drops=accept_drops
        self.monotonic=monotonic;self.started=monotonic()
        self.reports=[];self.failures={}
        self.history=ObservationHistory(self.output)
        self.history.seed(previous)
        try:self.state=json.loads((self.output/'crawl-attempts.json').read_text())
        except (OSError,ValueError):self.state={}
        self.state.setdefault('cinemas',{})
        self.state['last_run']={'started_at':now.isoformat(),'status':'running'}
        self.save()

    def save(self):atomic_write(self.output/'crawl-attempts.json',self.state)

    def record(self,cinema,error=None,count=None):
        old=self.state['cinemas'].get(cinema,{})
        reason=error.reason if isinstance(error,CatalogueHTTPError) else str(error) if isinstance(error,InvalidCatalogue) else type(error).__name__ if error else None
        self.state['cinemas'][cinema]={'last_attempt':datetime.now(timezone.utc).isoformat(),
            'status':'error' if error else 'validated','reason':reason,
            'consecutive_failures':old.get('consecutive_failures',0)+1 if error else 0,'observed_sessions':count}
        if error:self.failures[cinema]=reason
        self.save()
        print(json.dumps({'event':'cinema_collection','cinema_id':cinema,'status':'error' if error else 'ok',
                          'reason':reason,'count':count}),flush=True)

    def collect(self,cinemas,collector):
        try:
            result=collector()
            if not isinstance(result,dict) or not isinstance(result.get('sessions'),list):raise InvalidCatalogue('invalid_report_shape')
            if any(r.get('cinema_id') not in cinemas for r in result['sessions']):raise InvalidCatalogue('wrong_cinema')
        except Exception as error:
            for cinema in cinemas:self.record(cinema,error)
            return
        for cinema in cinemas:
            report={**result,'sessions':[r for r in result['sessions'] if r['cinema_id']==cinema]}
            try:
                checked_at=self.now+timedelta(seconds=max(0,self.monotonic()-self.started))
                report=validate_report(report,cinema,self.previous,checked_at,accept_drops=self.accept_drops)
            except Exception as error:
                self.record(cinema,error)
                continue
            # Preserve each accepted source immediately, even if a later source
            # or publication fails. Rebuilding pages/metadata never adds samples.
            self.history.record_catalogue(report,collected_at=checked_at.isoformat())
            self.reports.append(report);self.record(cinema,count=report['count'])

    def finish(self,published):
        for report in self.reports:
            if published:self.state['cinemas'][report['cinema_id']]['status']='ok'
        self.state['last_run'].update(finished_at=datetime.now(timezone.utc).isoformat(),
            status=('partial' if self.failures else 'ok') if published else 'publication_failed',
            accepted_cinemas=len(self.reports),failed_cinemas=len(self.failures))
        self.save()


def merge_catalogues(previous,addition,cinemas):
    from poster_policy import prefer_poster, copy_poster
    if previous is None:previous={'films':[],'coverage':[]}
    data=deepcopy(previous);replaced={c['cinema_id'] for c in addition['coverage']}
    aliases={key:f for f in data['films'] for key in [f['id'],*f.get('merged_ids',[])]}
    for film in data['films']:film['sessions']=[r for r in film['sessions'] if r['cinema_id'] not in replaced]
    for fresh in addition['films']:
        old=next((aliases[k] for k in [fresh['id'],*fresh.get('merged_ids',[])] if k in aliases),None)
        if old is None:data['films'].append(deepcopy(fresh));continue
        old['sessions'].extend(deepcopy(fresh['sessions']))
        old['titles']=list(dict.fromkeys([*old.get('titles',[]),*fresh.get('titles',[])]))
        old['merged_ids']=sorted(set([*old.get('merged_ids',[]),fresh['id'],*fresh.get('merged_ids',[])])-{old['id']})
        if prefer_poster(fresh,old):copy_poster(fresh,old)
    data['films']=[f for f in data['films'] if f['sessions']]
    old_coverage=coverage_by_cinema(previous)
    data['coverage']=[{**c,'cinema_id':cid} for cid,c in old_coverage.items() if cid not in replaced]+deepcopy(addition['coverage'])
    data.update(cinemas=deepcopy(cinemas),generated_at=addition['generated_at'],timezone='Europe/Madrid')
    deduplicate_programme(data)
    ids=[s['id'] for f in data['films'] for s in f['sessions']]
    if len(set(ids))!=len(ids):raise InvalidCatalogue('duplicate_session_after_merge')
    data['session_count']=len(ids)
    return data
