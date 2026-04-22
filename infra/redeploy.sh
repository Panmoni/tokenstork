#!/usr/bin/env bash
# infra/redeploy.sh — one-shot redeploy for the tokenstork SvelteKit app
# on carson, run as a normal sudoer after `git push` on warren.
#
# Sequence:
#   1. git pull in /opt/tokenstork as the tokenstork user
#   2. npm ci + npm run build as tokenstork (inherits their rustup/node PATH)
#   3. psql -f db/schema.sql (idempotent; ALTERs + CREATE INDEX IF NOT EXISTS)
#   4. systemctl restart tokenstork.service
#
# This script does NOT restart the Rust workers (sync-tail, sync-bcmr, ...).
# Use this for SvelteKit-only / schema-only deploys. Worker changes still
# need their own `cargo build --release` + per-service restart.
#
# Usage:
#   ssh carson
#   sudo /opt/tokenstork/infra/redeploy.sh
#
# Or from warren: ssh -t carson "sudo /opt/tokenstork/infra/redeploy.sh"

set -euo pipefail

REPO_DIR=/opt/tokenstork
SERVICE=tokenstork.service

if [ "$(id -u)" -ne 0 ]; then
	echo "redeploy.sh: must run as root (sudo $0)" >&2
	exit 1
fi

# tokenstork has `nologin` as its shell (systemd-only service user), so
# `sudo -iu` refuses. `sudo -u tokenstork bash -l -c` forces bash as a
# login shell so the PATH additions from ~/.profile (rustup, etc.) load.
run_as_tokenstork() {
	sudo -u tokenstork bash -l -c "$1"
}

echo "==> [1/4] git pull in ${REPO_DIR}"
run_as_tokenstork "cd ${REPO_DIR} && git pull --ff-only"

echo "==> [2/4] npm ci + build"
run_as_tokenstork "cd ${REPO_DIR} && npm ci && npm run build"

echo "==> [3/4] apply schema (idempotent)"
run_as_tokenstork "cd ${REPO_DIR} && psql -d tokenstork -f db/schema.sql > /tmp/schema-apply.log 2>&1 || (cat /tmp/schema-apply.log; exit 1)"
echo "    (schema output in /tmp/schema-apply.log)"

echo "==> [4/4] restart ${SERVICE}"
systemctl restart "${SERVICE}"
sleep 1
systemctl status "${SERVICE}" --no-pager --lines=0 | head -6

echo "==> done. tail with: sudo journalctl -u ${SERVICE} -f"
