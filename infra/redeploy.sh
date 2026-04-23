#!/usr/bin/env bash
# infra/redeploy.sh — one-shot redeploy for the tokenstork full stack on
# carson, run as a normal sudoer after `git push` on warren.
#
# Sequence:
#   1. git pull in /opt/tokenstork as the tokenstork user
#   2. npm ci + npm run build (SvelteKit app)
#   3. cargo build --release (Rust workers)
#   4. psql -f db/schema.sql (idempotent; ALTERs + CREATE INDEX IF NOT EXISTS)
#   5. systemctl restart tokenstork.service + sync-tail.service
#
# Worker services that are timer-triggered one-shots (sync-bcmr,
# sync-cauldron, sync-enrich, sync-verify) DON'T need a restart — the
# next timer tick will exec the freshly-built binary automatically.
# Only sync-tail is a long-running daemon holding the old binary open,
# so it gets an explicit restart. Any future always-on worker daemon
# needs to be added to DAEMON_SERVICES below.
#
# Usage:
#   ssh carson
#   sudo /opt/tokenstork/infra/redeploy.sh
#
# Or from warren: ssh -t carson "sudo /opt/tokenstork/infra/redeploy.sh"

set -euo pipefail

REPO_DIR=/opt/tokenstork
APP_SERVICE=tokenstork.service
DAEMON_SERVICES=(sync-tail.service)

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

echo "==> [1/5] git pull in ${REPO_DIR}"
run_as_tokenstork "cd ${REPO_DIR} && git pull --ff-only"

echo "==> [2/5] SvelteKit: npm ci + build"
run_as_tokenstork "cd ${REPO_DIR} && npm ci && npm run build"

echo "==> [3/5] Workers: cargo build --release"
run_as_tokenstork "cd ${REPO_DIR}/workers && cargo build --release"

echo "==> [4/5] apply schema (idempotent)"
run_as_tokenstork "cd ${REPO_DIR} && psql -d tokenstork -f db/schema.sql > /tmp/schema-apply.log 2>&1 || (cat /tmp/schema-apply.log; exit 1)"
echo "    (schema output in /tmp/schema-apply.log)"

echo "==> [5/5] restart ${APP_SERVICE}; restart always-on workers if running"
systemctl restart "${APP_SERVICE}"
sleep 1
systemctl status "${APP_SERVICE}" --no-pager --lines=0 | head -6
for svc in "${DAEMON_SERVICES[@]}"; do
	if systemctl is-active --quiet "${svc}"; then
		echo "    restarting ${svc}"
		systemctl restart "${svc}"
	else
		echo "    ${svc} is not active — skipping restart"
	fi
done

echo "==> done. tail with: sudo journalctl -u ${APP_SERVICE} -f"
