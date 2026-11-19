"""Failure injection for source isolation, freshness and concurrent publication."""
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import datetime,timedelta,timezone
import json
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import Mock

from build_cinema_preview import assemble
from catalogue_sources import CatalogueHTTP
from crawler_run import CrawlRun,InvalidCatalogue,merge_catalogues,validate_report
from crawler_health import health_snapshot,coverage_by_cinema
from programme_store import update_programme,file_lock

NOW=datetime(2026,11,19,12,tzinfo=timezone.utc)


def session(cid='a',sid='1',**extra):
    return {'id':cid+':'+sid,'provider':'test','cinema_id':cid,'film_id':'film','title':'Film',
            'starts_at':(NOW+timedelta(days=1)).isoformat(),'original_audio':True,'version':'VOSE',**extra}


def report(cid='a',rows=None,**extra):
    return {'provider':'test','cinema_id':cid,'fetched_at':NOW.isoformat(),
            'sessions':rows if rows is not None else [session(cid)],**extra}


def programme(rows=None):return assemble([report(rows=rows)],{'assets':[]},NOW)


class ContractTests(unittest.TestCase):
    def test_schedule_refresh_keeps_suitable_poster_over_a_larger_banner(self):
        old=programme();new=programme([session(sid='2')])
        old['films'][0].update(poster_url='/imdb.jpg',poster_width=800,poster_height=1200,
                               poster_provenance={'provider':'IMDb'})
        new['films'][0].update(poster_url='/banner.jpg',poster_width=2400,poster_height=1200)
        merged=merge_catalogues(old,new,old['cinemas'])
        self.assertEqual(merged['films'][0]['poster_url'],'/imdb.jpg')
        self.assertEqual(merged['films'][0]['poster_provenance']['provider'],'IMDb')
        self.assertEqual([s['id'] for s in merged['films'][0]['sessions']],['a:2'])
        # A smaller but suitable image also repairs a large invalid one.
        old['films'][0].update(poster_url='/square.jpg',poster_width=3000,poster_height=3000)
        new['films'][0].update(poster_url='/portrait.jpg',poster_width=600,poster_height=900)
        merged=merge_catalogues(old,new,old['cinemas'])
        self.assertEqual(merged['films'][0]['poster_url'],'/portrait.jpg')
        self.assertNotIn('poster_provenance',merged['films'][0])

    def test_wrong_venue_unproven_audio_naive_dates_future_receipts_rejected(self):
        for change in [{'cinema_id':'b'},{'original_audio':False},{'starts_at':'2026-11-20T19:00:00'},
                       {'id':''},{'title':''},{'film_id':''}]:
            with self.subTest(change=change),self.assertRaises(InvalidCatalogue):
                validate_report(report(rows=[session(**change)]),'a',None,NOW)
        with self.assertRaises(InvalidCatalogue):validate_report(report(fetched_at='2027-01-01T00:00:00Z'),'a',None,NOW)

    def test_duplicate_conflicts_fail_and_exact_duplicates_collapse(self):
        self.assertEqual(validate_report(report(rows=[session(),session()]),'a',None,NOW)['count'],1)
        with self.assertRaises(InvalidCatalogue):
            validate_report(report(rows=[session(),session(title='Another film')]),'a',None,NOW)

    def test_drop_guard_uses_remaining_future_sessions_not_old_total(self):
        old=programme([session(sid=str(i)) for i in range(20)])
        for rows in [[],[session()]]:
            with self.assertRaises(InvalidCatalogue):validate_report(report(rows=rows),'a',old,NOW)
        self.assertEqual(validate_report(report(rows=[]),'a',old,NOW,accept_drops=True)['count'],0)
        for film in old['films']:
            for row in film['sessions']:row['starts_at']=(NOW-timedelta(minutes=1)).isoformat()
        self.assertEqual(validate_report(report(rows=[]),'a',old,NOW)['count'],0)

    def test_programme_monitors_can_be_empty_without_failure(self):
        self.assertEqual(validate_report(report(rows=[]),'a',None,NOW)['count'],0)

    def test_older_source_receipt_cannot_replace_newer_catalogue(self):
        old=programme()
        with self.assertRaisesRegex(InvalidCatalogue,'source_timestamp_rolled_back'):
            validate_report(report(fetched_at=(NOW-timedelta(hours=1)).isoformat()),'a',old,NOW)

    def test_a_long_run_validates_receipts_against_elapsed_time(self):
        ticks=iter([0,600])
        with tempfile.TemporaryDirectory() as folder:
            run=CrawlRun(Path(folder),None,NOW,monotonic=lambda:next(ticks))
            run.collect(['a'],lambda:report(fetched_at=(NOW+timedelta(minutes=10)).isoformat()))
            self.assertEqual(len(run.reports),1)
            self.assertEqual(run.failures,{})

    def test_source_failure_does_not_stop_other_cinemas_or_advance_their_old_receipt(self):
        old=programme([session('a'),session('b')]);before=deepcopy(old)
        with tempfile.TemporaryDirectory() as folder:
            run=CrawlRun(Path(folder),old,NOW)
            run.collect(['a'],Mock(side_effect=TimeoutError('secret-bearing URL must not be logged')))
            run.collect(['b'],lambda:report('b',[session('b','2')]))
            new=assemble(run.reports,{'assets':[]},NOW+timedelta(hours=1))
            merged=merge_catalogues(old,new,old['cinemas']);run.finish(True)
            saved=json.loads((Path(folder)/'crawl-attempts.json').read_text())
        rows={s['id']:s for f in merged['films'] for s in f['sessions']}
        self.assertIn('a:1',rows);self.assertIn('b:2',rows);self.assertNotIn('b:1',rows)
        self.assertEqual(rows['a:1'],next(s for f in old['films'] for s in f['sessions'] if s['id']=='a:1'))
        self.assertEqual(old,before)
        self.assertEqual(saved['cinemas']['a']['reason'],'TimeoutError')
        self.assertEqual(saved['last_run']['status'],'partial')

    def test_one_invalid_cinema_in_shared_feed_does_not_discard_valid_sibling(self):
        with tempfile.TemporaryDirectory() as folder:
            run=CrawlRun(Path(folder),None,NOW)
            run.collect(['a','b'],lambda:report(rows=[session('a',original_audio=False),session('b')]))
            self.assertEqual([r['cinema_id'] for r in run.reports],['b'])
            self.assertIn('a',run.failures)

    def test_failed_merge_does_not_replace_snapshot(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'screenings.json';path.write_text(json.dumps({'keep':True}))
            with self.assertRaises(ValueError):update_programme(path,Mock(side_effect=ValueError()))
            self.assertEqual(json.loads(path.read_text()),{'keep':True})

    def test_concurrent_metadata_transactions_do_not_lose_updates(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'screenings.json';path.write_text(json.dumps({'count':0}))
            def increment(_):
                def edit(data):
                    value=data['count'];time.sleep(.002);data['count']=value+1;return data
                update_programme(path,edit)
            with ThreadPoolExecutor(max_workers=6) as pool:list(pool.map(increment,range(24)))
            self.assertEqual(json.loads(path.read_text())['count'],24)
            with file_lock(Path(folder)/'run.lock'):
                with self.assertRaises(BlockingIOError):
                    with file_lock(Path(folder)/'run.lock',blocking=False):pass


class HealthTests(unittest.TestCase):
    def policy(self,**extra):return {'cinemas':[{'id':'a','name':'Cinema A','kind':'cinema','stale_hours':6,'critical_hours':24,**extra}]}
    def data(self,checked):return {'cinemas':[{'id':'a'}],'films':[],'coverage':[{'cinema_id':'a','fetched_at':checked}]}
    def test_metadata_refresh_does_not_hide_stale_programme(self):
        data=self.data((NOW-timedelta(hours=7)).isoformat());data['generated_at']=NOW.isoformat()
        result=health_snapshot(data,{},NOW,self.policy())
        self.assertEqual(result['summary']['warning'],1)
        self.assertEqual(result['cinemas'][0]['age_hours'],7)
    def test_thresholds_and_invalid_timestamps(self):
        for hours,expected in [(5.99,'ok'),(6,'warning'),(24,'critical'),(-1,'critical')]:
            health=health_snapshot(self.data((NOW-timedelta(hours=hours)).isoformat()),{},NOW,self.policy())
            self.assertEqual(health['cinemas'][0]['severity'],expected)
        for checked in [None,'bad','2026-11-19T12:00:00']:
            self.assertEqual(health_snapshot(self.data(checked),{},NOW,self.policy())['summary']['critical'],1)
    def test_no_future_shows_is_not_staleness_and_failures_need_three_attempts(self):
        data=self.data(NOW.isoformat())
        for failures,expected in [(0,'ok'),(1,'ok'),(2,'ok'),(3,'warning')]:
            h=health_snapshot(data,{'cinemas':{'a':{'consecutive_failures':failures}}},NOW,self.policy())
            self.assertEqual(h['cinemas'][0]['severity'],expected)
    def test_legacy_shared_coverage_is_assigned_to_each_venue(self):
        result=coverage_by_cinema({'coverage':[{'source':'verdi','fetched_at':NOW.isoformat()}]})
        self.assertEqual(set(result),{'verdi','verdi-park'})


class TransportTests(unittest.TestCase):
    def response(self,status,text='programme'):
        return Mock(status_code=status,text=text,headers={},raise_for_status=Mock(side_effect=ValueError() if status>=400 else None))
    def test_transient_retry_then_success_and_challenge_not_cached(self):
        with tempfile.TemporaryDirectory() as folder:
            session=Mock();session.get.side_effect=[self.response(503),self.response(200)]
            wait=Mock();http=CatalogueHTTP(session,Path(folder),NOW,sleep=wait)
            self.assertEqual(http.get('https://cinema.example'),'programme');self.assertEqual(session.get.call_count,2)
            self.assertEqual(wait.call_count,1)
            session.get.side_effect=[self.response(202),self.response(200,'real page')]
            with self.assertRaises(ValueError):http.get('https://cinema.example/other')
            self.assertEqual(http.get('https://cinema.example/other'),'real page')
    def test_timeouts_are_bounded(self):
        with tempfile.TemporaryDirectory() as folder:
            session=Mock();session.get.side_effect=TimeoutError()
            with self.assertRaises(TimeoutError):CatalogueHTTP(session,Path(folder),NOW,sleep=Mock()).get('https://cinema.example')
            self.assertEqual(session.get.call_count,3)


if __name__=='__main__':unittest.main()
