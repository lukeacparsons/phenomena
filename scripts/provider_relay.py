"""Authenticated fallback for public programme reads; direct requests remain first."""
import json
import os
from pathlib import Path
from urllib.parse import urlsplit

ROOT=Path(__file__).resolve().parents[1]
CONFIG=ROOT/'.crawler-secrets/provider-relay.json'
POLICY=json.loads((ROOT/'data/provider-source-policy.json').read_text())
HOSTS=set(POLICY['a1_hosts']+POLICY['booking_hosts']+['www.moobycinemas.com','cinesfilmax.com','www.institutfrancais.es'])


class ProviderRelayError(ValueError):
    pass


def supported(url):
    parts=urlsplit(url)
    return parts.scheme=='https' and parts.hostname in HOSTS and not parts.username and not parts.password and parts.port in (None,443)


def siteground_check(status,html):
    return status in (200,202) and ('/.well-known/sgcaptcha/' in html or '<title>Robot Challenge Screen</title>' in html)


class ProgrammeRelay:
    def __init__(self,session,config_path=CONFIG):
        self.session=session
        try:self.config=json.loads(Path(config_path).read_text())
        except (OSError,ValueError):self.config={}
        if os.environ.get('VOBARNA_SOURCE_TOKEN'):
            self.config = {'url': 'https://vobarna-source-reader.luke-391.workers.dev/programme',
                           'token': os.environ['VOBARNA_SOURCE_TOKEN']}
        self.failed=set()

    def get(self,url):
        if not supported(url):raise ProviderRelayError('relay_origin_not_allowed')
        endpoint=self.config.get('url');token=self.config.get('token')
        # Credentials are sent only to this project's fixed Worker hostname.
        if endpoint!='https://vobarna-source-reader.luke-391.workers.dev/programme' or not token:
            raise ProviderRelayError('relay_not_configured')
        host=urlsplit(url).hostname
        if host in self.failed:raise ProviderRelayError('relay_origin_unavailable')
        try:
            response=self.session.post(endpoint,json={'url':url},headers={'Authorization':'Bearer '+token},timeout=90,allow_redirects=False)
            if response.status_code!=200 or siteground_check(response.status_code,response.text):
                raise ProviderRelayError('relay_programme_unavailable')
            if not response.headers.get('x-source-fetched-at'):
                raise ProviderRelayError('relay_receipt_missing')
            return response.text
        except Exception:
            self.failed.add(host)
            raise ProviderRelayError('relay_programme_unavailable') from None

    def close(self):
        pass
