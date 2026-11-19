"""Periodic, shared availability collection for the local cinema preview."""

from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import datetime, timezone
import json
import threading

from cinesa_showtimes import atomic_write
from premium_availability import (AvailabilityFetcher, ScreeningAvailabilityUnavailable,
                                  fetch_phenomena_availability)

SUPPORTED = {"phenomena", "mooby", "cinesa", "kinepolis", "verdi", "filmax"}


def timestamp(value):
    try:
        return datetime.fromisoformat(value).timestamp()
    except (TypeError, ValueError):
        return 0


def valid(value):
    return (isinstance(value, dict) and type(value.get("available")) is int
            and value["available"] >= 0 and timestamp(value.get("checked_at")) > 0)


class AvailabilityCache:
    def __init__(self, programme, path, interval=900, *, clock=None,
                 fetcher_factory=AvailabilityFetcher, phenomena_fetcher=fetch_phenomena_availability):
        self.programme, self.path, self.interval = programme, path, interval
        self.clock = clock or (lambda: datetime.now(timezone.utc).timestamp())
        self.fetcher_factory, self.phenomena_fetcher = fetcher_factory, phenomena_fetcher
        self.lock, self.stop_event = threading.Lock(), threading.Event()
        self.persist_lock = threading.Lock()
        self.next_checkpoint = 0
        self.sessions, self.errors, self.attempts, self.rows = {}, {}, {}, {}
        self.refreshing, self.thread = False, None
        try:
            saved = json.loads(path.read_text())
            self.sessions = {sid: value for sid, value in saved["sessions"].items() if valid(value)}
        except (OSError, ValueError, KeyError, TypeError):
            pass
        self._read_programme()

    def _read_programme(self):
        data = json.loads(self.programme.read_text())
        rows = {row["id"]: row for film in data["films"] for row in film["sessions"]
                if timestamp(row["starts_at"]) > self.clock()}
        with self.lock:
            self.rows = rows
            self.sessions = {sid: value for sid, value in self.sessions.items() if sid in rows}
            self.errors = {sid: value for sid, value in self.errors.items() if sid in rows}
            self.attempts = {sid: value for sid, value in self.attempts.items() if sid in rows}
            for sid, row in rows.items():
                seed = row.get("seat_data")
                if valid(seed) and timestamp(seed["checked_at"]) > timestamp(self.sessions.get(sid, {}).get("checked_at")):
                    self.sessions[sid] = seed

    def snapshot(self):
        with self.lock:
            return deepcopy({"sessions": self.sessions, "errors": self.errors,
                             "refreshing": self.refreshing, "refresh_interval_seconds": self.interval,
                             "supported_providers": sorted(SUPPORTED)})

    def _record(self, row, value=None):
        with self.lock:
            sid = row["id"]
            self.attempts[sid] = self.clock()
            if valid(value):
                self.sessions[sid] = value
                self.errors.pop(sid, None)
            else:
                # Retain the previous count AND its acquisition time on failure.
                self.errors[sid] = {"attempted_at": datetime.fromtimestamp(self.clock(), timezone.utc).isoformat()}
            checkpoint = self.clock() >= self.next_checkpoint
            if checkpoint:
                self.next_checkpoint = self.clock() + 60
        if checkpoint:
            self._persist()

    def _persist(self):
        # Snapshot inside this lock so a delayed writer cannot replace newer
        # observations. Long passes and restarts retain incremental progress.
        with self.persist_lock:
            atomic_write(self.path, self.snapshot())

    def _collect_provider(self, provider, rows):
        if provider == "phenomena":
            try:
                values = self.phenomena_fetcher()
            except Exception:
                values = {}
            for row in rows:
                self._record(row, values.get(row["id"]))
            return
        failures = 0
        with self.fetcher_factory() as fetcher:
            # Sequential per chain; at most four chains run concurrently.
            for row in sorted(rows, key=lambda row: timestamp(row["starts_at"])):
                if self.stop_event.is_set():
                    break
                value = None
                if failures < 5:
                    try:
                        value = fetcher.fetch(row)
                    except ScreeningAvailabilityUnavailable:
                        # A verified response without a seat map is specific
                        # to this performance, not evidence of a chain outage.
                        failures = 0
                    except Exception:
                        failures += 1
                    else:
                        failures = 0 if valid(value) else failures + 1
                self._record(row, value)

    def refresh(self):
        self._read_programme()
        with self.lock:
            if self.refreshing:
                return
            now = self.clock()
            due = [row for sid, row in self.rows.items() if row["provider"] in SUPPORTED
                   and now - self.attempts.get(sid, 0) >= self.interval
                   and (sid in self.errors or now - timestamp(self.sessions.get(sid, {}).get("checked_at")) >= self.interval)]
            self.refreshing = bool(due)
        if not due:
            return
        try:
            groups = {provider: [row for row in due if row["provider"] == provider] for provider in SUPPORTED}
            with ThreadPoolExecutor(max_workers=4) as pool:
                jobs = [pool.submit(self._collect_provider, provider, rows) for provider, rows in groups.items() if rows]
                for job in jobs:
                    job.result()
        finally:
            with self.lock:
                self.refreshing = False
            self._persist()
        counts = self.snapshot()
        print(f"Seats: {len(counts['sessions'])} cached, {len(counts['errors'])} unavailable; next refresh in {self.interval // 60} min", flush=True)

    def _run(self):
        while not self.stop_event.is_set():
            try:
                self.refresh()
            except Exception as error:
                print(f"Seat refresh failed ({type(error).__name__}); previous counts retained", flush=True)
            self.stop_event.wait(30)

    def start(self):
        self.thread = threading.Thread(target=self._run, name="seat-refresh", daemon=True)
        self.thread.start()

    def stop(self):
        self.stop_event.set()
        if self.thread is not None:
            self._persist()
