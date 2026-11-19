from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import Mock, patch

from crawler_monitor import publish_health, send_heartbeat, HEARTBEAT_URL
from provider_relay import ProgrammeRelay
from run_deployed_crawler import bootstrap, healthy


class DeployedCrawlerTests(unittest.TestCase):
    def test_bootstrap_preserves_newer_collector_state_and_registry(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);source=root/'publication/current';cache=root/'cache';registry=root/'registry.json'
            (source/'public').mkdir(parents=True)
            (source/'catalogue.json').write_text(json.dumps({'films': [], 'cinemas':[{'id':'one'}]}))
            (source/'public/availability.json').write_text('{}')
            (source/'registry.json').write_text('{"version":1}')
            bootstrap(root/'publication',cache,registry)
            newer={'films':[],'cinemas':[{'id':'two'}]}
            (cache/'screenings.json').write_text(json.dumps(newer));registry.write_text('{"version":2}')
            bootstrap(root/'publication',cache,registry)
            self.assertEqual(json.loads((cache/'screenings.json').read_text()),newer)
            self.assertEqual(json.loads(registry.read_text()),{'version':2})

    def test_missing_seed_is_not_an_empty_success(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            with self.assertRaises(FileNotFoundError):bootstrap(root/'missing',root/'cache',root/'registry.json')

    def test_runtime_health_rejects_dead_stale_future_and_invalid_status(self):
        now=datetime.now(timezone.utc)
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'health.json'
            def write(**extra):path.write_text(json.dumps({'pid':os.getpid(),'state':'active','checked_at':now.isoformat(),**extra}))
            write();self.assertTrue(healthy(path,now))
            write(state='standby');self.assertTrue(healthy(path,now))
            for change in [{'state':'failed'},{'checked_at':(now-timedelta(seconds=121)).isoformat()},
                           {'checked_at':(now+timedelta(seconds=1)).isoformat()},{'pid':99999999}]:
                write(**change);self.assertFalse(healthy(path,now))

    def test_server_heartbeat_uses_scoped_sender_and_preserves_last_success(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ,{'VOBARNA_HEARTBEAT_TOKEN':'test-secret'}):
            runner=Mock()
            with patch('crawler_monitor.send_heartbeat') as send:
                first=publish_health(Path(folder),runner=runner)
                self.assertEqual(first['status'],'ok');runner.assert_not_called()
                self.assertEqual(send.call_args.args[1],'test-secret')
                send.side_effect=ValueError('bad acknowledgement')
                failed=publish_health(Path(folder),runner=runner)
                self.assertEqual(failed['status'],'error')
                self.assertEqual(failed['last_success'],first['last_success'])

    def test_heartbeat_destination_is_fixed_and_response_must_acknowledge_receipt(self):
        health={'checked_at':'2026-11-19T20:00:00+00:00'}
        response=Mock(status=200)
        response.__enter__=Mock(return_value=response);response.__exit__=Mock(return_value=False)
        response.read.return_value=json.dumps({'ok':True,**health}).encode()
        with patch('crawler_monitor.urllib.request.build_opener') as opener:
            opener.return_value.open.return_value=response
            send_heartbeat(health,'test-secret')
            request=opener.return_value.open.call_args.args[0]
            self.assertEqual(request.full_url,HEARTBEAT_URL)
            self.assertEqual(request.get_header('Authorization'),'Bearer test-secret')
            self.assertEqual(request.get_header('User-agent'),'VOBarnaCollector/1.0')
            response.read.return_value=b'{"ok":true,"checked_at":"older"}'
            with self.assertRaises(ValueError):send_heartbeat(health,'test-secret')

    def test_provider_reader_supports_runtime_secret_without_local_secret_file(self):
        with patch.dict(os.environ,{'VOBARNA_SOURCE_TOKEN':'runtime-only'}):
            relay=ProgrammeRelay(Mock(),'/missing/config')
            self.assertEqual(relay.config['token'],'runtime-only')
            self.assertEqual(relay.config['url'],'https://vobarna-source-reader.luke-391.workers.dev/programme')

    def test_rolling_containers_have_only_one_collector_writer(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);(root/'static/preview-data').mkdir(parents=True)
            code='''import sys
from pathlib import Path
import run_crawler as crawler
crawler.ROOT=Path(sys.argv[1])
class Service:
    thread=None
    def __init__(self,*a,**kw):pass
    def start(self):Path(sys.argv[2]).touch()
    def stop(self):pass
for name in ['HealthPublisher','PublicRefresher','AvailabilityCache','RatingsRefresher']:
    setattr(crawler,name,Service)
crawler.main()
'''
            children=[]
            def launch(name):
                env={**os.environ,'PYTHONPATH':str(Path(__file__).parent),'VOBARNA_WAIT_FOR_LEASE':'1',
                     'VOBARNA_RUNTIME_HEALTH':str(root/(name+'.health'))}
                child=subprocess.Popen([sys.executable,'-c',code,str(root),str(root/name)],env=env,
                                       stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
                children.append(child);return child
            def wait_for(check):
                deadline=time.monotonic()+8
                while time.monotonic()<deadline:
                    if check():return
                    time.sleep(.05)
                self.fail('Collector state did not advance')
            try:
                first=launch('first');wait_for(lambda:(root/'first').exists())
                second=launch('second');wait_for(lambda:(root/'second.health').exists())
                self.assertEqual(json.loads((root/'second.health').read_text())['state'],'standby')
                self.assertFalse((root/'second').exists())
                first.terminate();first.wait(timeout=3)
                wait_for(lambda:(root/'second').exists())
                self.assertEqual(second.poll(),None)
            finally:
                for child in children:
                    if child.poll() is None:child.terminate()
                    child.communicate(timeout=3)
