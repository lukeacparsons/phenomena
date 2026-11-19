"""The nine approved nearby cinemas and six regular cultural programmes."""
from datetime import datetime
from catalogue_sources import report, MADRID
from cinesa_showtimes import CinesaClient, ChromeTransport, collect as collect_cinesa
from explore_premium_showtimes import yelmo_sessions
from nearby_catalogues import (SHOP_VENUES, CAPRI_PROGRAMME, collect_cinema_shop,
                               collect_cinebaix, collect_capri, collect_ocine_magic)
from cultural_catalogues import (PROGRAMMES, collect_elizalde, collect_caixaforum,
                                 collect_institut, collect_programme_monitor)

NEARBY_CINEMAS = [
    ('cinebaix','CineBaix','CineBaix','Sant Feliu de Llobregat','https://www.cinebaix.cat/'),
    ('cinema-capri','Cinema Capri','Capri','El Prat de Llobregat',CAPRI_PROGRAMME),
    ('sant-cugat-cinemas','Sant Cugat Cinemas','Sant Cugat Cinemas','Sant Cugat del Vallès','https://www.cinemessantcugat.com/'),
    ('cinemes-montcada','Cinemes Montcada','Montcada','Montcada i Reixac','https://www.cinemesmontcada.com/'),
    ('can-castellet','Cinemes Can Castellet','Can Castellet','Sant Boi de Llobregat','https://www.cinemescancastellet.com/'),
    ('cinesa-barnasud','Cinesa LUXE Barnasud','Barnasud','Gavà','https://www.cinesa.es/cines/barnasud/'),
    ('yelmo-castelldefels','Yelmo Premium Castelldefels','Yelmo Castelldefels','Castelldefels','https://yelmocines.es/cartelera/barcelona/premium-castelldefels'),
    ('yelmo-sant-cugat','Yelmo Premium Sant Cugat','Yelmo Sant Cugat','Sant Cugat del Vallès','https://yelmocines.es/cartelera/barcelona/premium-sant-cugat'),
    ('ocine-magic','OCINE Màgic Badalona','OCINE Màgic','Badalona','https://www.ocinemagic.es/'),
]
CULTURAL_VENUES = [
    ('institut-francais','Institut Français de Barcelona','Institut Français','Barcelona · Sarrià-Sant Gervasi',PROGRAMMES['institut-francais']),
    ('cccb','CCCB / Xcèntric','CCCB / Xcèntric','Barcelona · El Raval',PROGRAMMES['cccb']),
    ('caixaforum-barcelona','CaixaForum Barcelona','CaixaForum','Barcelona · Montjuïc',PROGRAMMES['caixaforum-barcelona']),
    ('casa-elizalde','La Casa Elizalde','Casa Elizalde','Barcelona · Eixample',PROGRAMMES['casa-elizalde']),
    ('centre-cultural-albareda','Centre Cultural Albareda','Albareda','Barcelona · Poble-sec',PROGRAMMES['centre-cultural-albareda']),
    ('can-carol','Casal de Barri Can Carol','Can Carol','Barcelona · Vallcarca',PROGRAMMES['can-carol']),
]
PROGRAMME_ONLY = {'cccb','centre-cultural-albareda','can-carol'}
BIG_SCREEN_CRITERIA = {'cinesa-barnasud':'Original audio · IMAX or iSense',
                       'yelmo-castelldefels':'Original audio · PREMIUM, XE or ATMOS',
                       'yelmo-sant-cugat':'Original audio · PREMIUM, XE or ATMOS'}
ADDITIONAL_CINEMAS = [dict(id=i,name=n,short=s,area=a,url=u,
    criteria='Regular film programme' if i in PROGRAMME_ONLY else 'Original audio · All rooms',
    big_screen_criteria=BIG_SCREEN_CRITERIA.get(i),category=kind,
    programme_url=PROGRAMMES.get(i,u),catalogue_mode='programme_links_only' if i in PROGRAMME_ONLY else 'verified_original_audio')
    for entries,kind in [(NEARBY_CINEMAS,'cinema'),(CULTURAL_VENUES,'cultural_screening_venue')]
    for i,n,s,a,u in entries]
ADDITIONAL_IDS = {c['id'] for c in ADDITIONAL_CINEMAS}


def nearby_and_cultural_catalogues(http, now):
    def checked(cinema, result):
        if any(r['cinema_id'] != cinema for r in result['sessions']):
            raise ValueError('Expansion collector returned a different venue')
        result['cinema_id']=cinema
        print(cinema,result['count'],'original-audio sessions',flush=True)
        return result

    for cinema in SHOP_VENUES:
        yield checked(cinema, collect_cinema_shop(http,now,cinema))
    for cinema,collector in [('cinebaix',collect_cinebaix),('cinema-capri',collect_capri),('ocine-magic',collect_ocine_magic)]:
        yield checked(cinema,collector(http,now))
    transport=ChromeTransport()
    try:
        yield checked('cinesa-barnasud',collect_cinesa(CinesaClient(transport,venue='barnasud'),
                      now.astimezone(MADRID).date(),None,now,premium_only=False,original_only=True))
    finally:
        transport.close()
    response=http.session.post('https://yelmocines.es/now-playing.aspx/GetNowPlaying',json={'cityKey':'barcelona'},timeout=30)
    response.raise_for_status();payload=response.json()
    for venue,cinema in [('premium-castelldefels','yelmo-castelldefels'),('premium-sant-cugat','yelmo-sant-cugat')]:
        rows,warnings=yelmo_sessions(payload,premium_only=False,original_only=True,venue=venue)
        if warnings:raise ValueError('Yelmo has unverified date-boundary sessions')
        for item in rows:
            item['starts_at']=datetime.fromisoformat(item['date']+'T'+item['time']).replace(tzinfo=MADRID).isoformat()
        yield checked(cinema,report('yelmo',rows,now))
    for cinema,collector in [('institut-francais',collect_institut),('caixaforum-barcelona',collect_caixaforum),('casa-elizalde',collect_elizalde)]:
        yield checked(cinema,collector(http,now))
    for cinema in sorted(PROGRAMME_ONLY):
        yield checked(cinema,collect_programme_monitor(http,now,cinema))
