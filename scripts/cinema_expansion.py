"""Curated directory entries and source orchestration for the expanded feed."""
from catalogue_sources import (A1, collect_a1, collect_renoir, collect_filmoteca,
                               collect_zumzeig, collect_texas, collect_malda,
                               collect_filmax, collect_ateneu)
from programme_expansion import ADDITIONAL_CINEMAS, nearby_and_cultural_catalogues

NEW_CINEMAS = [
    ('mooby-arenas','Mooby Arenas','Arenas','Barcelona · Eixample','https://www.moobycinemas.com/arenas'),
    ('mooby-glories','Mooby Glòries','Glòries','Barcelona · Sant Martí','https://www.moobycinemas.com/glories'),
    ('mooby-sarria','Mooby Gran Sarrià Club','Gran Sarrià','Barcelona · Sarrià','https://www.moobycinemas.com/sarria'),
    ('cinesa-diagonal','Cinesa Diagonal','Diagonal','Barcelona · Sarrià-Sant Gervasi','https://www.cinesa.es/cines/diagonal/'),
    ('cinesa-som-multiespai','Cinesa SOM Multiespai','SOM Multiespai','Barcelona · Nou Barris','https://www.cinesa.es/cines/som-multiespai/'),
    ('verdi','Cinemes Verdi','Verdi','Barcelona · Gràcia','https://barcelona.cines-verdi.com/'),
    ('verdi-park','Cinemes Verdi Park','Verdi Park','Barcelona · Gràcia','https://barcelona.cines-verdi.com/on-som'),
    ('cinemes-girona','Cinemes Girona','Girona','Barcelona · Eixample','https://www.cinemesgirona.cat/'),
    ('renoir-floridablanca','Renoir Floridablanca','Renoir','Barcelona · Eixample','https://www.cinesrenoir.com/cine/renoir-floridablanca/cartelera/'),
    ('zumzeig','Zumzeig Cinecooperativa','Zumzeig','Barcelona · Sants','https://zumzeigcine.coop/'),
    ('filmoteca-catalunya','Filmoteca de Catalunya','Filmoteca','Barcelona · El Raval','https://www.filmoteca.cat/web/ca'),
    ('espai-texas','Espai Texas','Texas','Barcelona · Gràcia','https://espaitexas.cat/cartellera-cinema/'),
    ('cinema-malda','Cinema Maldà','Maldà','Barcelona · Ciutat Vella','https://www.cinemamalda.com/'),
    ('filmax-gran-via','Cines Filmax Gran Via','Filmax','L’Hospitalet de Llobregat','https://cinesfilmax.com/'),
    ('ateneu-barcelones','Ateneu Barcelonès','Ateneu','Barcelona · Ciutat Vella','https://ateneubcn.cat/programacio/'),
]
NEW_CINEMAS = [dict(id=i,name=n,short=s,area=a,url=u,criteria='Original audio · All rooms',
                   big_screen_criteria=None,category='cultural_screening_venue' if i=='ateneu-barcelones' else 'cinema')
               for i,n,s,a,u in NEW_CINEMAS]
NEW_CINEMAS += ADDITIONAL_CINEMAS


def expanded_catalogues(http, now, a1_payloads, languages):
    for provider in A1:
        result = collect_a1(provider, a1_payloads[provider], http, now)
        print(provider, result['count'], 'original-audio sessions', flush=True)
        yield result
    for collect in [collect_renoir, collect_filmoteca, collect_zumzeig, collect_texas, collect_malda,
                    lambda h,n: collect_filmax(h,n,languages), collect_ateneu]:
        result = collect(http, now)
        print(result['provider'], result['count'], 'original-audio sessions', flush=True)
        yield result
    yield from nearby_and_cultural_catalogues(http, now)
