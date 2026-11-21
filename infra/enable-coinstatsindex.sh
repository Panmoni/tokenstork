#!/usr/bin/env bash
# Turn on coinstatsindex on carson's BCHN (PAN-230). Run it from a machine
# that can `ssh carson` with passwordless sudo there. A live run can take
# ~40 min (stop + index wait); run it inside tmux so an ssh drop does not
# lose the output.
#
#   infra/enable-coinstatsindex.sh --dry-run   # read-only preflight
#   infra/enable-coinstatsindex.sh             # edit live conf + restart bchn
#   infra/enable-coinstatsindex.sh --status    # index build progress
#
# What the live run does on carson:
#   1. Preflight: bitcoind is v29+, MemAvailable >= 4096 MiB (the PAN-182
#      threshold, infra/memstat/summary.py), >= 50 GiB free on the datadir
#      (safety margin, not a measured need), the conf is readable, has no
#      [section] headers and no conflicting coinstatsindex= line.
#   2. If the flag is already in the conf AND getindexinfo lists
#      coinstatsindex, it exits without restarting anything.
#   3. Backs the conf up to bitcoin.conf.bak-pan230-<epoch> (0600, bchn).
#   4. Appends `coinstatsindex=1`, unless it is already there.
#   5. `systemctl restart bchn`. The stop can take up to TimeoutStopSec
#      (600s) while BCHN flushes. BlockBook, sync-tail and the tokenstork
#      workers reconnect to RPC/ZMQ on their own.
#   6. Waits up to 30 min for RPC to answer with coinstatsindex listed in
#      getindexinfo, then prints it. On any failure after the edit it
#      prints the rollback command and exits non-zero.
#
# The index builds in the background from genesis while the node stays
# usable. Estimate, not measured on carson: several hours (budget 6-12 h)
# and a few GB of disk. Done when `--status` shows coinstatsindex
# "synced": true with best_block_height at the tip; then
# `bitcoin-cli gettxoutsetinfo muhash <past height>` answers.
#
# Rollback: copy the .bak file over bitcoin.conf, restart bchn, then delete
# the index directory it built under /var/lib/bchn/.bitcoin/indexes/
# (expected name `coinstats`; confirm with ls before deleting).
set -euo pipefail

HOST="${CARSON_HOST:-carson}"
mode=apply
case "${1:-}" in
	"") ;;
	--dry-run) mode=dry-run ;;
	--status) mode=status ;;
	*) echo "usage: $0 [--dry-run|--status]" >&2; exit 2 ;;
esac

# The remote half runs under `bash -s` on carson; MODE arrives as $1.
ssh -- "$HOST" bash -s -- "$mode" <<'REMOTE'
set -euo pipefail
MODE="$1"
DATADIR=/var/lib/bchn/.bitcoin
CONF="$DATADIR/bitcoin.conf"
# -rpcclienttimeout caps each call so the 30-min wait below is a real cap
# (the default is 900s per call).
cli() { sudo -n -u bchn /usr/local/bin/bitcoin-cli -datadir="$DATADIR" -rpcclienttimeout=30 "$@"; }
# A plain string match: `| grep -q` under pipefail can SIGPIPE the cli.
has_index() { [[ "$(cli getindexinfo 2>/dev/null)" == *'"coinstatsindex"'* ]]; }

if [[ "$MODE" == status ]]; then
	tip=$(cli getblockcount)
	echo "tip: $tip"
	cli getindexinfo
	exit 0
fi

# `exit` does not fire the ERR trap, so fail prints the rollback line
# itself once the conf has been touched.
hint=
fail() {
	echo "ABORT: $*" >&2
	[[ -z "$hint" ]] || echo "rollback: $hint" >&2
	exit 1
}
trap 'rc=$?; echo "ABORT: line $LINENO: $BASH_COMMAND (exit $rc)" >&2; [[ -z "$hint" ]] || echo "rollback: $hint" >&2' ERR

ver=$(/usr/local/bin/bitcoind --version | head -1)
major=$(grep -oE 'v[0-9]+' <<<"$ver" | head -1 | tr -d v) || true
[[ -n "$major" && "$major" -ge 29 ]] || fail "need BCHN 29+, have: $ver"
echo "ok: $ver"

avail=$(awk '/^MemAvailable:/ {print int($2/1024)}' /proc/meminfo)
(( avail >= 4096 )) || fail "MemAvailable ${avail} MiB < 4096 MiB"
echo "ok: MemAvailable ${avail} MiB"

free_gb=$(df -BG --output=avail "$DATADIR" | tail -1 | tr -dc 0-9)
(( free_gb >= 50 )) || fail "only ${free_gb} GiB free on $DATADIR"
echo "ok: ${free_gb} GiB free on $DATADIR"

sudo -n test -r "$CONF" || fail "cannot read $CONF"
rc=0
sudo -n grep -qE '^[[:space:]]*(\[|includeconf[[:space:]]*=)' "$CONF" || rc=$?
(( rc == 1 )) || fail "$CONF has [section]/includeconf lines (an appended flag could be shadowed) or grep failed (exit $rc)"

cli_out=$(cli getblockcount 2>&1) || fail "bitcoin-cli unusable before any change: $cli_out"
echo "ok: bitcoin-cli answers, tip $cli_out"

# grep exits 1 on no match, 2 on error; only 1 means "flag absent".
rc=0
existing=$(sudo -n grep -E '^[[:space:]]*coinstatsindex[[:space:]]*=' "$CONF") || rc=$?
(( rc <= 1 )) || fail "grep on $CONF failed (exit $rc)"
if [[ -z "$existing" ]]; then
	need_edit=1
	echo "plan: append coinstatsindex=1 to $CONF"
elif [[ "$(tr -d '[:space:]' <<<"$existing")" == "coinstatsindex=1" ]]; then
	need_edit=0
	echo "ok: $CONF already has coinstatsindex=1"
	if has_index; then
		echo "done: coinstatsindex is already live; nothing to restart"
		cli getindexinfo
		exit 0
	fi
else
	fail "conflicting line(s) in $CONF: $existing"
fi

if [[ "$MODE" == dry-run ]]; then
	if (( need_edit )); then
		echo "dry-run: would back up $CONF, append the flag, restart bchn"
	else
		echo "dry-run: would restart bchn only"
	fi
	cli getindexinfo
	exit 0
fi

if (( need_edit )); then
	bak="$CONF.bak-pan230-$(date +%s)"
	sudo -n install -m 0600 -o bchn -g bchn "$CONF" "$bak"
	echo "backup: $bak"
	hint="sudo install -m 0600 -o bchn -g bchn $bak $CONF && sudo systemctl restart bchn"
	echo "rollback (if needed): $hint"
	# Guard against a conf with no trailing newline, which would glue the
	# flag onto the last line. $(...) strips a final newline, so the result
	# is empty exactly when the file already ends in one.
	last=$(sudo -n tail -c1 "$CONF") || fail "cannot read the end of $CONF"
	if [[ -n "$last" ]]; then
		echo | sudo -n -u bchn tee -a "$CONF" >/dev/null
	fi
	echo "coinstatsindex=1" | sudo -n -u bchn tee -a "$CONF" >/dev/null
	echo "edited: $CONF"
else
	hint="the conf already had the flag; remove the coinstatsindex=1 line and restart bchn"
fi

echo "restarting bchn (stop can take up to 10 min)..."
sudo -n systemctl restart bchn
for _ in $(seq 180); do
	has_index && break
	systemctl is-active --quiet bchn || fail "bchn is not active; see journalctl -u bchn"
	sleep 10
done
if ! has_index; then
	last_err=$(cli getindexinfo 2>&1 >/dev/null) || true
	fail "coinstatsindex not listed after 30 min (last cli error: ${last_err:-none}); check journalctl -u bchn and the conf"
fi
hint=
echo "ok: coinstatsindex is live and building"
cli getblockcount || echo "warn: getblockcount re-read failed" >&2
cli getindexinfo || echo "warn: getindexinfo re-read failed" >&2
REMOTE
