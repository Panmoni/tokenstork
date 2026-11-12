#!/usr/bin/env bash
# carson memory-headroom sampler (PAN-182). Run once a minute by
# carson-memstat.timer; appends one TSV row per run to $MEMSTAT_LOG.
#
# Reads /proc directly instead of shelling out to free / vmstat:
#   - /proc/meminfo is what `free -m` prints (values here in MiB, as free -m).
#   - /proc/pressure/memory is the PSI file.
#   - /proc/vmstat pswpin/pswpout are the cumulative counters behind
#     vmstat's si/so columns; summary.py turns deltas into a rate, which
#     cannot miss swap between samples the way a point-in-time si/so can.
#
# Capped: stops writing once the first row is older than MEMSTAT_DAYS
# (default 7), so a forgotten timer cannot grow the log without bound.
set -euo pipefail

LOG="${MEMSTAT_LOG:-/var/lib/tokenstork/memstat/memstat.tsv}"
DAYS="${MEMSTAT_DAYS:-7}"
HEADER=$'ts\tmem_total_mb\tmem_available_mb\tmem_free_mb\tbuff_cache_mb\tswap_total_mb\tswap_used_mb\tpsi_some_avg10\tpsi_some_avg60\tpsi_some_avg300\tpsi_some_total_us\tpsi_full_avg10\tpsi_full_avg60\tpsi_full_avg300\tpsi_full_total_us\tpswpin\tpswpout'

now=$(date +%s)

if [[ -s "$LOG" ]]; then
	first=$(sed -n '2{s/\t.*//;p;q}' "$LOG")
	if [[ -n "$first" ]] && (( now - first >= DAYS * 86400 )); then
		echo "memstat: ${DAYS}-day window complete since ${first}; not sampling"
		exit 0
	fi
else
	printf '%s\n' "$HEADER" >"$LOG"
fi

declare -A mi
while read -r key val _; do
	mi[${key%:}]=$val
done </proc/meminfo

mb() { echo $(( ${1:-0} / 1024 )); }
buff_cache_kb=$(( ${mi[Buffers]:-0} + ${mi[Cached]:-0} + ${mi[SReclaimable]:-0} ))
swap_used_kb=$(( ${mi[SwapTotal]:-0} - ${mi[SwapFree]:-0} ))

# PSI lines: "some avg10=0.00 avg60=0.00 avg300=0.00 total=3424"
declare -A psi
while read -r kind a10 a60 a300 total; do
	psi[${kind}_a10]=${a10#avg10=}
	psi[${kind}_a60]=${a60#avg60=}
	psi[${kind}_a300]=${a300#avg300=}
	psi[${kind}_total]=${total#total=}
done </proc/pressure/memory

pswpin=0
pswpout=0
while read -r key val; do
	case $key in
		pswpin) pswpin=$val ;;
		pswpout) pswpout=$val ;;
	esac
done </proc/vmstat

printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
	"$now" \
	"$(mb "${mi[MemTotal]}")" "$(mb "${mi[MemAvailable]}")" "$(mb "${mi[MemFree]}")" \
	"$(mb "$buff_cache_kb")" "$(mb "${mi[SwapTotal]}")" "$(mb "$swap_used_kb")" \
	"${psi[some_a10]}" "${psi[some_a60]}" "${psi[some_a300]}" "${psi[some_total]}" \
	"${psi[full_a10]}" "${psi[full_a60]}" "${psi[full_a300]}" "${psi[full_total]}" \
	"$pswpin" "$pswpout" >>"$LOG"
