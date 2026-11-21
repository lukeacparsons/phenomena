# Outrageous Otter storage policy

Installed on 21 November 2026. Source is in this directory; no credentials are stored here.

## What runs

- **Otter (`178.105.17.34`):** `otter-storage-guard.timer` checks `/` and `/mnt/volume-fsn1-1` every five minutes. Warnings use the existing VO Barna Telegram topic. Warning: 75% used or less than 10 GiB available. Critical: 85% used or less than 5 GiB available. Critical reminders are limited to hourly, warning reminders to six-hourly. Recovery requires 70% or less and at least 11 GiB available on both disks.
- **Coolify:** native cleanup at minute 7 every hour, regardless of the system-disk percentage. Unused volume/network deletion stays disabled. Application rollback retention stays enabled (current images plus two unused versions per app).
- **Management host (`116.203.11.163`):** `otter-cleanup-retry.timer` checks every five minutes. Once deployments settle for two minutes, it dispatches Coolify's non-manual cleanup job. It retries skipped/failed jobs at most every 15 minutes. Coolify's own queue and per-server lock prevent overlapping cleanup. Queued/running deployments postpone cleanup.
- **Internal Plunk logs:** when its application is running, regular PM2 and nginx log files are checked every five minutes. Files over 10 MiB are copied and truncated; up to three compressed rotations per filename are retained in `/var/log/otter-container-logs/plunk-mail`. Each rotation is bounded to the latest 10 MiB, including a previously oversized log. This is a periodic threshold, not a hard filesystem quota. Docker stdout/stderr retain their existing 10 MB × 3 limits.

## Build payload retention

Use the installed runner for new temporary host builds:

```sh
otter-build my-release -- sh -c 'your complete build, publish and verification command'
```

The command runs inside a fresh `payload` directory below `/var/tmp/otter-builds`. Both disks must have at least 5 GiB free. Exit zero means the whole task is complete: its disposable payload is removed, unless a detached process still holds it. A failed payload expires after seven days. Keep anything that must survive in an explicit persistent destination, outside the payload. A receipt remains beside the payload; build logs rotate at 10 MiB, retain three compressed copies, and expire 30 days after completion. An interrupted job with a `running` receipt requires reconciliation and is never deleted automatically.

The same preflight is installed as an extra `ExecStartPre` for the existing `ojo-web-release.service`. Its existing disabled timer and profile guard are preserved. This preflight covers the Ojo service and `otter-build`; it does not intercept arbitrary shell builds or Coolify's separate build pipeline.

Once an hour the host guard also expires named payloads in dated Ojo staging directories after seven days, and old queue bundle artifacts after seven days while keeping the newest two release sequences, the active and preceding sequence, and any pending bundle. Small legacy logs and release receipts remain. Source repositories, configuration, databases, Docker volumes, historical reports and database backups are outside the deletion policy.

Deletion requires an idle Ojo queue lock, no running Coolify helper, no process/container/mount references, and an unchanged directory tree. Symlink targets and nested filesystems are rejected. An inspection failure prevents collection and produces an alert.

## Inspect and verify

On Otter:

```sh
python3 /opt/otter-storage-guard/host_guard.py status
python3 /opt/otter-storage-guard/host_guard.py plan
systemctl status otter-storage-guard.timer
journalctl -u otter-storage-guard.service --since today
```

On the management host:

```sh
python3 /opt/otter-storage-guard/cleanup_retry.py
systemctl status otter-cleanup-retry.timer
journalctl -u otter-cleanup-retry.service --since today
```

The retry command defaults to read-only; `--apply` may dispatch a cleanup. The host `plan` command is read-only. Current receipts are `/var/lib/otter-storage-guard/status.json` on Otter and `/var/lib/otter-cleanup-retry/state.json` on the management host. Earlier Coolify settings are saved beside the latter.

To pause automation, disable the corresponding timers. Coolify's hourly setting is independent and can be changed in its Docker Cleanup page. No control-plane or application container restart is needed for this installation.

Run focused policy tests with `python3 -m unittest discover -s deploy/otter-storage-guard -p 'test_*.py'`.
