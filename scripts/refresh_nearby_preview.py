#!/usr/bin/env python3
"""Refresh the approved nearby/cultural additions, preserving other catalogues.

This independent refresh is useful when an unrelated city source is unavailable.
Each cinema is validated and published independently. Failed cinemas retain
their previous sessions and collection timestamps; film metadata survives.
"""
import argparse
from copy import deepcopy
from datetime import datetime, timezone
import json
from pathlib import Path

from build_cinema_preview import CINEMAS, OUTPUT, assemble
from catalogue_sources import CatalogueHTTP
from cinesa_showtimes import atomic_write
from collect_posters import collect as collect_posters
from film_grouping import deduplicate_programme, session_order
from programme_expansion import ADDITIONAL_IDS, nearby_and_cultural_catalogues
from poster_policy import prefer_poster, copy_poster


def merge_expansion(previous, addition):
    covered={c['cinema_id'] for c in addition['coverage']}
    if covered != ADDITIONAL_IDS:
        raise ValueError('Incomplete expansion refresh; existing programme retained')
    data=deepcopy(previous)
    aliases={key:f for f in data['films'] for key in [f['id'],*f.get('merged_ids',[])]}
    for film in data['films']:
        film['sessions']=[s for s in film['sessions'] if s['cinema_id'] not in ADDITIONAL_IDS]
    for new in addition['films']:
        old=next((aliases[k] for k in [new['id'],*new.get('merged_ids',[])] if k in aliases),None)
        if old is None:
            data['films'].append(deepcopy(new))
            continue
        old['sessions'].extend(deepcopy(new['sessions']))
        old['titles']=list(dict.fromkeys([*old.get('titles',[]),*new.get('titles',[])]))
        old['merged_ids']=sorted(set([*old.get('merged_ids',[]),new['id'],*new.get('merged_ids',[])])-{old['id']})
        if prefer_poster(new,old):copy_poster(new,old)
    data['films']=[f for f in data['films'] if f['sessions']]
    data['coverage']=[c for c in data['coverage'] if c.get('cinema_id') not in ADDITIONAL_IDS]+deepcopy(addition['coverage'])
    data['cinemas']=deepcopy(CINEMAS)
    data['generated_at']=addition['generated_at']
    data['last_partial_refresh']={'at':addition['generated_at'],'cinema_ids':sorted(ADDITIONAL_IDS)}
    deduplicate_programme(data)
    for film in data['films']:film['sessions'].sort(key=session_order)
    data['films'].sort(key=lambda f:session_order(f['sessions'][0]))
    data['session_count']=sum(len(f['sessions']) for f in data['films'])
    ids=[s['id'] for f in data['films'] for s in f['sessions']]
    if len(set(ids)) != len(ids):raise ValueError('Duplicate screening identity after expansion')
    return data


def main():
    from build_cinema_preview import refresh_catalogues
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-dir',type=Path,default=OUTPUT)
    parser.add_argument('--accept-count-drops',action='store_true')
    args=parser.parse_args()
    return refresh_catalogues(args.output_dir,skip_enrichment=True,nearby_only=True,
                              accept_drops=args.accept_count_drops)


if __name__=='__main__':
    raise SystemExit(main())
