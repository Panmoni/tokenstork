#!/usr/bin/env bash
# infra/redeploy.sh — one-shot redeploy for the tokenstork full stack on
# carson, run as a normal sudoer after `git push` on warren.
#
# Sequence:
#   1. git pull in /opt/tokenstork as the tokenstork user
#   2. npm ci + npm run build (SvelteKit app)
#   3. cargo build --release (Rust workers)
#   4. psql -f db/schema.sql (idempotent; ALTERs + CREATE INDEX IF NOT EXISTS)
#   5. install/refresh infra/systemd/* into /etc/systemd/system (+ daemon-reload)
#   6. sync infra/Caddyfile to /etc/caddy/Caddyfile (+ reload caddy if changed)
#   7. systemctl restart tokenstork.service + sync-tail.service
#
# Worker services that are timer-triggered one-shots (sync-bcmr,
# sync-cauldron, sync-enrich, sync-verify) DON'T need a restart — the
# next timer tick will exec the freshly-built binary automatically.
# Only sync-tail is a long-running daemon holding the old binary open,
# so it gets an explicit restart. Any future always-on worker daemon
# needs to be added to DAEMON_SERVICES below.
#
# Step 5 installs any *.service/*.timer from infra/systemd/ that isn't
# already in /etc/systemd/system or differs from what's installed. It
# does NOT enable or start newly-installed units — that's an operator
# decision (e.g., oneshot backfills are run-once-manually; timers need
# a deliberate `systemctl enable --now X.timer`).
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

# Capture our own hash before `git pull` can update redeploy.sh on disk
# out from under us. Compared post-pull so a self-update can re-exec.
SELF="$(readlink -f "$0")"
SELF_HASH="$(sha256sum "${SELF}" | cut -d' ' -f1)"

echo "==> [1/7] git pull in ${REPO_DIR}"
run_as_tokenstork "cd ${REPO_DIR} && git pull --ff-only"

# Bash reads this script into memory at launch, so if the git pull above
# just updated redeploy.sh on disk, we're still running the old copy in
# memory. Without this re-exec, changes to redeploy.sh only take effect
# on the NEXT deploy — surprising in exactly the wrong way (we've been
# bitten twice). `exec` replaces the current process with the new
# script; step 1's git pull will run again on the new version, but
# it's a no-op since we're at HEAD.
if [ "$(sha256sum "${SELF}" | cut -d' ' -f1)" != "${SELF_HASH}" ]; then
	echo "==> redeploy.sh was updated — re-exec'ing with the new version"
	exec "${SELF}" "$@"
fi

echo "==> [2/7] SvelteKit: npm ci + build"
run_as_tokenstork "cd ${REPO_DIR} && npm ci && npm run build"

echo "==> [3/7] Workers: cargo build --release"
run_as_tokenstork "cd ${REPO_DIR}/workers && cargo build --release"

echo "==> [4/7] apply schema (idempotent)"
run_as_tokenstork "cd ${REPO_DIR} && psql -d tokenstork -f db/schema.sql > /tmp/schema-apply.log 2>&1 || (cat /tmp/schema-apply.log; exit 1)"
echo "    (schema output in /tmp/schema-apply.log)"

echo "==> [5/7] systemd units: install/refresh from infra/systemd/"
# Copy any *.service / *.timer from the repo into /etc/systemd/system if
# it's missing or differs. `cmp -s` keeps the step idempotent — a no-op
# run logs nothing. Only daemon-reload if something actually changed, so
# a no-change redeploy doesn't churn systemd state. Does NOT enable or
# start new units — that's deliberate (see header comment).
UNIT_SRC_DIR="${REPO_DIR}/infra/systemd"
UNIT_DST_DIR="/etc/systemd/system"
UNITS_CHANGED=0
shopt -s nullglob
for unit in "${UNIT_SRC_DIR}"/*.service "${UNIT_SRC_DIR}"/*.timer; do
	fname=$(basename "${unit}")
	dest="${UNIT_DST_DIR}/${fname}"
	if ! cmp -s "${unit}" "${dest}" 2>/dev/null; then
		install -m 0644 -o root -g root "${unit}" "${dest}"
		echo "    installed ${fname}"
		UNITS_CHANGED=1
	fi
done
shopt -u nullglob
if [ "${UNITS_CHANGED}" -eq 1 ]; then
	systemctl daemon-reload
	echo "    systemctl daemon-reload"
else
	echo "    (no unit changes)"
fi

echo "==> [6/7] Caddy: sync infra/Caddyfile to /etc/caddy/"
# Validate BEFORE install so a bad Caddyfile doesn't get copied over
# a good /etc/caddy/Caddyfile only for the subsequent reload to fail.
# Previous behavior (install → reload → fail) would leave the new file
# on disk matching the next deploy's cmp-s check, causing the reload
# to never be retried; validate-first keeps the on-disk file in sync
# with what Caddy is actually running.
CADDYFILE_SRC="${REPO_DIR}/infra/Caddyfile"
CADDYFILE_DST=/etc/caddy/Caddyfile
if [ -f "${CADDYFILE_SRC}" ]; then
	if ! cmp -s "${CADDYFILE_SRC}" "${CADDYFILE_DST}" 2>/dev/null; then
		# `caddy validate` exits non-zero (set -e aborts the deploy)
		# on any syntax or directive error — faster than waiting for
		# systemctl reload to surface the same failure, and crucially
		# leaves /etc/caddy/Caddyfile untouched if invalid.
		echo "    validating ${CADDYFILE_SRC}"
		caddy validate --config "${CADDYFILE_SRC}" --adapter caddyfile >/dev/null
		install -m 0644 -o root -g root "${CADDYFILE_SRC}" "${CADDYFILE_DST}"
		echo "    installed Caddyfile; reloading caddy.service"
		systemctl reload caddy.service
	else
		echo "    (no Caddyfile changes)"
	fi
else
	echo "    (infra/Caddyfile missing — skipping)"
fi

echo "==> [7/7] restart ${APP_SERVICE}; restart always-on workers if running"
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
