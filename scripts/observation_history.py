"""Compact, append-only acquisition history, separate from replaceable web caches."""
from contextlib import closing
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sqlite3
import threading


METRICS = {'availability': 1, 'price': 2}
STATUSES = {'ok': 0, 'not_reported': 1, 'error': 2, 'skipped': 3, 'unavailable': 4}
ORIGINS = {'bootstrap': 0, 'availability': 1, 'catalogue': 2}
EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)


def micros(value):
    """Integer UTC microseconds; never invent a timestamp for an old cache."""
    try:
        instant = datetime.fromisoformat(value)
        if instant.tzinfo is None:
            return None
        delta = instant.astimezone(timezone.utc) - EPOCH
        return (delta.days * 86400 + delta.seconds) * 1_000_000 + delta.microseconds
    except (TypeError, ValueError):
        return None


def encoded(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False)


def valid_seats(value):
    return (isinstance(value, dict) and type(value.get('available')) is int
            and value['available'] >= 0 and (micros(value.get('checked_at')) or 0) > 0)


SCHEMA = """
CREATE TABLE IF NOT EXISTS screenings (
    id INTEGER PRIMARY KEY,
    digest BLOB NOT NULL UNIQUE,
    session_id TEXT NOT NULL,
    context_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS screenings_session ON screenings(session_id);
CREATE TABLE IF NOT EXISTS states (
    id INTEGER PRIMARY KEY,
    digest BLOB NOT NULL UNIQUE,
    value_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS samples (
    id INTEGER PRIMARY KEY,
    screening_id INTEGER NOT NULL REFERENCES screenings(id),
    metric INTEGER NOT NULL CHECK(metric IN (1, 2)),
    collected_at_us INTEGER NOT NULL,
    checked_at_us INTEGER,
    state_id INTEGER REFERENCES states(id),
    status INTEGER NOT NULL CHECK(status BETWEEN 0 AND 4),
    origin INTEGER NOT NULL CHECK(origin BETWEEN 0 AND 2),
    UNIQUE(screening_id, metric, collected_at_us, origin)
);
CREATE VIEW IF NOT EXISTS observation_history AS
SELECT s.id, c.session_id,
       CASE s.metric WHEN 1 THEN 'availability' ELSE 'price' END AS metric,
       s.collected_at_us, s.checked_at_us,
       CASE s.status WHEN 0 THEN 'ok' WHEN 1 THEN 'not_reported' WHEN 2 THEN 'error'
                     WHEN 3 THEN 'skipped' ELSE 'unavailable' END AS status,
       CASE s.origin WHEN 0 THEN 'bootstrap' WHEN 1 THEN 'availability' ELSE 'catalogue' END AS origin,
       c.context_json, v.value_json
FROM samples s JOIN screenings c ON c.id = s.screening_id
LEFT JOIN states v ON v.id = s.state_id;
"""


class ObservationHistory:
    def __init__(self, directory):
        self.path = Path(directory) / 'history' / 'observations.sqlite3'
        self._ready = False
        self._init_lock = threading.Lock()

    def _connect(self):
        # Each transaction owns its connection: provider threads and the
        # catalogue subprocess share SQLite's locking, never a Python connection.
        with self._init_lock:
            if not self._ready:
                self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                with closing(sqlite3.connect(self.path, timeout=30)) as db:
                    version = db.execute('PRAGMA user_version').fetchone()[0]
                    if version not in (0, 1):
                        raise ValueError('Unsupported observation history schema')
                    db.execute('PRAGMA journal_mode=WAL')
                    db.executescript(SCHEMA)
                    db.execute('PRAGMA user_version=1')
                self._ready = True
        db = sqlite3.connect(self.path, timeout=30)
        db.execute('PRAGMA foreign_keys=ON')
        db.execute('PRAGMA synchronous=FULL')
        return db

    @staticmethod
    def _context(row):
        # Version these small dimensions when identity/room changes; do not
        # repeat posters, synopses, metadata, or the entire programme per check.
        keys = ('id', 'provider', 'provider_session_id', 'cinema_id', 'film_id',
                'title', 'starts_at', 'room', 'version', 'format', 'booking_url', 'source_url')
        context = {key: row[key] for key in keys if row.get(key) is not None}
        context['provider'] = row.get('provider') or row['id'].split(':')[0]
        if micros(row.get('starts_at')) is not None:
            context['starts_at'] = datetime.fromisoformat(row['starts_at']).astimezone(timezone.utc).isoformat()
        if str(row.get('room', '')).isdigit():
            context['room'] = str(int(row['room']))
        if 'VOSE' in str(row.get('version') or '').upper():
            context['version'] = 'VOSE'
        return context

    @staticmethod
    def _intern(db, table, value, session_id=None):
        payload = encoded(value)
        digest = hashlib.sha256(payload.encode()).digest()
        if table == 'screenings':
            db.execute('INSERT INTO screenings(digest, session_id, context_json) VALUES (?, ?, ?) '
                       'ON CONFLICT(digest) DO NOTHING', (digest, session_id, payload))
        else:
            db.execute('INSERT INTO states(digest, value_json) VALUES (?, ?) '
                       'ON CONFLICT(digest) DO NOTHING', (digest, payload))
        return db.execute(f'SELECT id FROM {table} WHERE digest=?', (digest,)).fetchone()[0]

    def _write(self, entries, *, origin):
        entries = list(entries)
        if not entries:
            return
        with closing(self._connect()) as db, db:
            for row, metric, collected_at, value, status in entries:
                collected = micros(collected_at)
                if collected is None:
                    raise ValueError('Observation needs an acquisition timestamp')
                checked = micros(value.get('checked_at')) if value else None
                if status == 'ok' and checked is None:
                    raise ValueError('Successful observation needs a source timestamp')
                screening = self._intern(db, 'screenings', self._context(row), row['id'])
                state = self._intern(db, 'states', {k: v for k, v in value.items() if k != 'checked_at'}) if value else None
                if origin == 'bootstrap' and db.execute(
                    'SELECT 1 FROM samples WHERE screening_id=? AND metric=? '
                    'AND checked_at_us IS ? AND state_id IS ? AND status=? LIMIT 1',
                    (screening, METRICS[metric], checked, state, STATUSES[status])
                ).fetchone():
                    continue
                db.execute('INSERT INTO samples(screening_id, metric, collected_at_us, checked_at_us, '
                           'state_id, status, origin) VALUES (?, ?, ?, ?, ?, ?, ?) '
                           'ON CONFLICT(screening_id, metric, collected_at_us, origin) DO NOTHING',
                           (screening, METRICS[metric], collected, checked, state, STATUSES[status], ORIGINS[origin]))

    def record_availability(self, row, value, *, collected_at, status='ok', reason=None):
        if status == 'ok' and not valid_seats(value):
            raise ValueError('Invalid seat observation')
        payload = value if status == 'ok' else ({'reason': reason} if reason else None)
        self._write([(row, 'availability', collected_at, payload, status)], origin='availability')

    def record_catalogue(self, report, *, collected_at):
        entries = []
        for row in report['sessions']:
            price = row.get('price_data')
            if price:
                price = {**price, 'checked_at': price.get('checked_at') or report['fetched_at']}
            entries.append((row, 'price', collected_at, price, 'ok' if price else 'not_reported'))
            if valid_seats(row.get('seat_data')):
                entries.append((row, 'availability', collected_at, row['seat_data'], 'ok'))
        self._write(entries, origin='catalogue')

    def seed(self, programme, availability=None):
        """Import surviving observations once, at their original source times."""
        rows = {row['id']: row for film in (programme or {}).get('films', []) for row in film['sessions']}
        entries = []
        for row in rows.values():
            for metric, value in [('price', row.get('price_data')), ('availability', row.get('seat_data'))]:
                if (value and (micros(value.get('checked_at')) or 0) > 0
                        and (metric == 'price' or valid_seats(value))):
                    entries.append((row, metric, value['checked_at'], value, 'ok'))
        for sid, value in (availability or {}).get('sessions', {}).items():
            if valid_seats(value):
                entries.append((rows.get(sid, {'id': sid}), 'availability', value['checked_at'], value, 'ok'))
        self._write(entries, origin='bootstrap')

    def seed_files(self, programme, availability):
        data = json.loads(Path(programme).read_text())
        try:
            seats = json.loads(Path(availability).read_text())
        except (OSError, ValueError):
            seats = {}
        self.seed(data, seats)


def main():
    import argparse
    import csv
    import sys
    from datetime import timedelta

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data-dir', type=Path, default=Path(__file__).resolve().parents[1] / 'static/preview-data')
    commands = parser.add_subparsers(dest='command', required=True)
    commands.add_parser('seed', help='Import existing caches without requesting providers')
    commands.add_parser('status', help='Show counts and database size')
    export = commands.add_parser('export', help='Stream history as CSV to stdout')
    export.add_argument('--session')
    export.add_argument('--metric', choices=METRICS)
    backup = commands.add_parser('backup', help='Create a consistent SQLite backup, including WAL data')
    backup.add_argument('destination', type=Path)
    args = parser.parse_args()
    history = ObservationHistory(args.data_dir)
    if args.command == 'seed':
        history.seed_files(args.data_dir / 'screenings.json', args.data_dir / 'availability.json')
        return
    with closing(sqlite3.connect(history.path.resolve().as_uri() + '?mode=ro', uri=True, timeout=30)) as db:
        if args.command == 'backup':
            if args.destination.exists():
                parser.error('Backup destination already exists')
            with closing(sqlite3.connect(args.destination)) as target:
                db.backup(target)
        elif args.command == 'status':
            counts = {table: db.execute(f'SELECT count(*) FROM {table}').fetchone()[0]
                      for table in ('samples', 'states', 'screenings')}
            counts['bytes'] = sum(p.stat().st_size for p in history.path.parent.glob('observations.sqlite3*'))
            print(json.dumps(counts))
        else:
            where, values = [], []
            for column, value in [('session_id', args.session), ('metric', args.metric)]:
                if value:
                    where.append(column + '=?')
                    values.append(value)
            query = 'SELECT * FROM observation_history' + (' WHERE ' + ' AND '.join(where) if where else '')
            cursor = db.execute(query + ' ORDER BY collected_at_us, id', values)
            writer = csv.writer(sys.stdout)
            names = [c[0].removesuffix('_us') for c in cursor.description]
            writer.writerow(names)
            for row in cursor:
                values = list(row)
                for index in (3, 4):
                    values[index] = (EPOCH + timedelta(microseconds=values[index])).isoformat() if values[index] is not None else ''
                writer.writerow(values)


if __name__ == '__main__':
    main()
