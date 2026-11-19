from datetime import datetime, timezone
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

from catalogue_sources import CatalogueHTTP, CatalogueHTTPError
from provider_relay import ProgrammeRelay, ProviderRelayError
from crawler_sources import collect_mooby

URL='https://barcelona.cines-verdi.com/api/get-events'
CHECK='<meta http-equiv="refresh" content="0;/.well-known/sgcaptcha/">'


class RelayTests(unittest.TestCase):
    def test_one_mooby_page_failure_does_not_discard_the_shared_programme(self):
        http=Mock()
        http.get.side_effect=lambda url: (_ for _ in ()).throw(TimeoutError()) if url.endswith('/aribau') else 'programme'
        with patch('crawler_sources.mooby_sessions',return_value=[{'id':'one'}]):
            result=collect_mooby(http,datetime.now(timezone.utc),{})
        self.assertEqual(result['coverage']['unavailable_pages'],['aribau'])
        self.assertEqual(result['sessions'][0]['source_url'],'https://www.moobycinemas.com/balmes')

    def response(self,status,text):
        return Mock(status_code=status,text=text,headers={'x-source-fetched-at':datetime.now(timezone.utc).isoformat()})

    def test_direct_success_does_not_use_relay(self):
        with tempfile.TemporaryDirectory() as folder:
            session=Mock();session.get.return_value=self.response(200,'real data');factory=Mock()
            with CatalogueHTTP(session,folder,datetime.now(timezone.utc),relay_factory=factory) as http:
                self.assertEqual(http.get(URL),'real data')
            factory.assert_not_called()

    def test_known_check_uses_relay_and_caches_only_success(self):
        with tempfile.TemporaryDirectory() as folder:
            session=Mock();session.get.return_value=self.response(202,CHECK);relay=Mock();relay.get.return_value='{"result":[]}'
            with CatalogueHTTP(session,folder,datetime.now(timezone.utc),relay_factory=lambda _:relay) as http:
                self.assertEqual(http.json(URL),{'result':[]})
                self.assertEqual(http.json(URL),{'result':[]})
            self.assertEqual(relay.get.call_count,1);relay.close.assert_called_once()

    def test_arbitrary_202_or_unapproved_origin_never_uses_relay(self):
        with tempfile.TemporaryDirectory() as folder:
            factory=Mock();session=Mock()
            for url,text in [(URL,'pending'),('https://other.example/',CHECK)]:
                session.get.return_value=self.response(202,text)
                with self.assertRaises(CatalogueHTTPError):CatalogueHTTP(session,folder,datetime.now(timezone.utc),relay_factory=factory).get(url)
            factory.assert_not_called()

    def test_failed_relay_is_not_cached_as_a_programme(self):
        with tempfile.TemporaryDirectory() as folder:
            session=Mock();session.get.return_value=self.response(202,CHECK);relay=Mock();relay.get.side_effect=ProviderRelayError('unavailable')
            with CatalogueHTTP(session,folder,datetime.now(timezone.utc),relay_factory=lambda _:relay) as http:
                with self.assertRaises(ProviderRelayError):http.get(URL,cached=True)
                self.assertEqual(http.memory,{})
            self.assertEqual(list(Path(folder).glob('*.json')),[])

    def test_credentials_only_go_to_fixed_reader_and_failure_is_bounded(self):
        with tempfile.TemporaryDirectory() as folder:
            config=Path(folder)/'config.json';config.write_text(json.dumps({'url':'https://vobarna-source-reader.luke-391.workers.dev/programme','token':'fake-token'}))
            session=Mock();session.post.return_value=self.response(502,'failed')
            relay=ProgrammeRelay(session,config)
            for _ in range(2):
                with self.assertRaises(ProviderRelayError):relay.get(URL)
            self.assertEqual(session.post.call_count,1)
            self.assertFalse(session.post.call_args.kwargs['allow_redirects'])
            config.write_text(json.dumps({'url':'https://wrong.example/','token':'fake-token'}))
            with self.assertRaises(ProviderRelayError):ProgrammeRelay(session,config).get(URL)
            self.assertEqual(session.post.call_count,1)


if __name__=='__main__':unittest.main()
