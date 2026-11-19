"""Per-cinema freshness from published source timestamps, never file modification time."""
from datetime import datetime, timezone
import argparse
import json
from pathlib import Path

from cinesa_showtimes import atomic_write

ROOT=Path(__file__).resolve().parents[1]
POLICY=ROOT/'data/crawler-policy.json'
LEGACY_GROUPS={'mooby':['mooby-aribau','mooby-balmes','mooby-bosque','mooby-arenas','mooby-glories','mooby-sarria'],
              'verdi':['verdi','verdi-park'],'yelmo':['yelmo-maquinista'],'girona':['cinemes-girona'],
              'renoir':['renoir-floridablanca'],'filmoteca':['filmoteca-catalunya'],'zumzeig':['zumzeig'],
              'texas':['espai-texas'],'malda':['cinema-malda'],'filmax':['filmax-gran-via'],'ateneu':['ateneu-barcelones']}


def instant(value):
    try:
        date=datetime.fromisoformat(value.replace('Z','+00:00'))
        return date if date.tzinfo is not None else None
    except (ValueError,TypeError,AttributeError):return None


def coverage_by_cinema(data):
    result={}
    for c in data.get('coverage',[]):
        ids=[c['cinema_id']] if c.get('cinema_id') else LEGACY_GROUPS.get(c.get('source'),[])
        for cid in ids:
            prior=instant(result.get(cid,{}).get('fetched_at'))
            current=instant(c.get('fetched_at'))
            if cid not in result or (current and (not prior or current>prior)):result[cid]=c
    return result


def health_snapshot(data,attempts,now,policy=None):
    policy=policy or json.loads(POLICY.read_text())
    coverage=coverage_by_cinema(data or {})
    present={c['id'] for c in (data or {}).get('cinemas',[])}
    rows=[r for f in (data or {}).get('films',[]) for r in f.get('sessions',[])]
    venues=[]
    for cinema in policy['cinemas']:
        cid=cinema['id'];record=coverage.get(cid,{})
        checked=instant(record.get('fetched_at'))
        age=(now-checked).total_seconds()/3600 if checked else None
        attempt=attempts.get('cinemas',{}).get(cid,{})
        reasons=[];severity='ok'
        if cid not in present or age is None:severity='critical';reasons.append('missing_source_timestamp')
        elif age < -5/60:severity='critical';reasons.append('future_source_timestamp')
        elif age>=cinema['critical_hours']:severity='critical';reasons.append('stale')
        elif age>=cinema['stale_hours']:severity='warning';reasons.append('stale')
        if attempt.get('consecutive_failures',0)>=3:
            if severity=='ok':severity='warning'
            reasons.append('repeated_collection_failure')
        upcoming=[r for r in rows if r.get('cinema_id')==cid and instant(r.get('starts_at')) and instant(r['starts_at'])>=now]
        venues.append({**cinema,'last_success':record.get('fetched_at') if cid in present else None,'age_hours':round(age,2) if age is not None else None,
            'severity':severity,'reasons':reasons,'last_attempt':attempt.get('last_attempt'),
            'last_result':attempt.get('status'),'failure_reason':attempt.get('reason'),
            'consecutive_failures':attempt.get('consecutive_failures',0),'future_sessions':len(upcoming),
            'last_screening':max((r['starts_at'] for r in upcoming),default=None),
            'coverage_mode':(record.get('coverage') or {}).get('mode')})
    return {'schema_version':1,'checked_at':now.isoformat(),'cinemas':venues,
            'summary':{key:sum(v['severity']==key for v in venues) for key in ['ok','warning','critical']},
            'last_run':attempts.get('last_run')}


def read_health(output,now=None):
    now=now or datetime.now(timezone.utc);output=Path(output)
    try:data=json.loads((output/'screenings.json').read_text())
    except (OSError,ValueError):data={}
    try:attempts=json.loads((output/'crawl-attempts.json').read_text())
    except (OSError,ValueError):attempts={}
    return health_snapshot(data,attempts,now)


def refresh_health(output,now=None):
    output=Path(output)
    result=read_health(output,now)
    atomic_write(output/'crawler-health.json',result)
    return result


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-dir',type=Path,default=ROOT/'static/preview-data')
    args=parser.parse_args();health=refresh_health(args.output_dir)
    print(json.dumps(health,ensure_ascii=False,indent=2))
    return 1 if health['summary']['warning'] or health['summary']['critical'] else 0


if __name__=='__main__':raise SystemExit(main())
