#!/usr/bin/env python3
"""Summarise a carson-memstat TSV log (PAN-182) as Markdown.

Usage: summary.py memstat.tsv > infra/memstat/baseline-YYYY-MM-DD.md

Prints the MemAvailable low tail (min/p01/p05) and p50, PSI some/full avg60,
the swap-in rate and a yes/no verdict on "carson can take the coinstatsindex
build". Stdlib only, so it runs on carson or on a workstation against a
copied log.

Verdict thresholds (defaults, stated in the output):
  - A full week: span >= 6.9 days AND >= 95% of the expected 1-min samples.
  - p05 MemAvailable >= 4096 MiB. A coinstatsindex build is a background
    LevelDB index walk under BCHN's existing dbcache; 4 GiB is about 2x what
    it plausibly needs on top of today's load.
  - swap-in under normal load: p95 rate == 0 pages/s and mean < 1 page/s.
    This is the plan's own exit criterion ("carson swaps under normal load").
  - PSI memory pressure: p95 some avg60 < 10 and p95 full avg60 < 1.
"""

import csv
import itertools
import math
import statistics
import sys
from datetime import datetime, timezone

SAMPLE_SECS = 60
MAX_INTERVAL_SECS = 180  # longer than this is an outage; excluded from rates
MIN_SPAN_DAYS = 6.9
MIN_COVERAGE = 0.95
MIN_AVAIL_P05_MB = 4096
MAX_SWAPIN_P95 = 0.0
MAX_SWAPIN_MEAN = 1.0
MAX_PSI_SOME_P95 = 10.0
MAX_PSI_FULL_P95 = 1.0


def pct(values, p):
    """Nearest-rank percentile: the ceil(p/100 * n)-th smallest value."""
    s = sorted(values)
    if not s:
        return float("nan")
    return s[max(0, math.ceil(p / 100 * len(s)) - 1)]


def iso(ts):
    return datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%d %H:%M UTC")


def load(path):
    """Return (well-formed rows, count of rows skipped as truncated/malformed)."""
    with open(path, newline="") as f:
        reader = csv.DictReader(f, delimiter="\t")
        good, bad = [], 0
        for r in reader:
            if None in r or any(v in (None, "") for v in r.values()):
                bad += 1
                continue
            try:
                int(r["ts"]), float(r["psi_full_avg60"]), int(r["pswpin"])
            except ValueError:
                bad += 1
                continue
            good.append(r)
    return good, bad


def main(path):
    rows, malformed = load(path)
    if len(rows) < 2:
        sys.exit(f"{path}: need at least 2 well-formed rows, found {len(rows)}")

    ts = [int(r["ts"]) for r in rows]
    avail = [int(r["mem_available_mb"]) for r in rows]
    swap_used = [int(r["swap_used_mb"]) for r in rows]
    some60 = [float(r["psi_some_avg60"]) for r in rows]
    full60 = [float(r["psi_full_avg60"]) for r in rows]

    # Swap-in rate from the cumulative pswpin counter. Intervals that are
    # non-positive, longer than MAX_INTERVAL_SECS (an outage — the burst would
    # be averaged away, or a reboot reset the counter), or that run the
    # counter backwards (a reboot) are excluded and counted as gaps.
    rates, gaps, swapin_pages = [], 0, 0
    for prev, cur in itertools.pairwise(rows):
        dt = int(cur["ts"]) - int(prev["ts"])
        d = int(cur["pswpin"]) - int(prev["pswpin"])
        if dt <= 0 or dt > MAX_INTERVAL_SECS or d < 0:
            gaps += 1
            continue
        rates.append(d / dt)
        swapin_pages += d

    span_secs = ts[-1] - ts[0]
    span_days = span_secs / 86400
    coverage = len(rows) / (span_secs / SAMPLE_SECS + 1)
    full_week = span_days >= MIN_SPAN_DAYS and coverage >= MIN_COVERAGE

    a_p05 = pct(avail, 5)
    s_p95, f_p95 = pct(some60, 95), pct(full60, 95)
    r_p95 = pct(rates, 95) if rates else 0.0
    r_mean = statistics.fmean(rates) if rates else 0.0

    checks = [
        (
            f"full week (span >= {MIN_SPAN_DAYS} d, coverage >= {MIN_COVERAGE:.0%})",
            full_week,
            f"{span_days:.2f} d, {coverage:.1%}",
        ),
        (f"p05 MemAvailable >= {MIN_AVAIL_P05_MB} MiB", a_p05 >= MIN_AVAIL_P05_MB, f"{a_p05} MiB"),
        (f"swap-in p95 == {MAX_SWAPIN_P95:g} pages/s", r_p95 <= MAX_SWAPIN_P95, f"{r_p95:.3f}"),
        (f"swap-in mean < {MAX_SWAPIN_MEAN:g} page/s", r_mean < MAX_SWAPIN_MEAN, f"{r_mean:.3f}"),
        (f"PSI some avg60 p95 < {MAX_PSI_SOME_P95:g}", s_p95 < MAX_PSI_SOME_P95, f"{s_p95:.2f}"),
        (f"PSI full avg60 p95 < {MAX_PSI_FULL_P95:g}", f_p95 < MAX_PSI_FULL_P95, f"{f_p95:.2f}"),
    ]
    verdict = "YES" if all(ok for _, ok, _ in checks) else "NO"

    out = []
    w = out.append
    w("# carson memory headroom baseline (PAN-182)")
    w("")
    w(f"**Can carson take the coinstatsindex build? {verdict}.**")
    w("")
    w(f"- Window: {iso(ts[0])} to {iso(ts[-1])} ({span_days:.2f} days)")
    w(f"- Samples: {len(rows)} ({coverage:.1%} of expected), {gaps} intervals excluded, {malformed} malformed rows skipped")
    w(f"- MemTotal: {rows[-1]['mem_total_mb']} MiB, swap total {rows[-1]['swap_total_mb']} MiB")
    w("")
    w("MemAvailable (MiB), low tail first — the headroom that matters:")
    w("")
    w("| min | p01 | p05 | p50 |")
    w("|---|---|---|---|")
    w(f"| {min(avail)} | {pct(avail, 1)} | {a_p05} | {pct(avail, 50)} |")
    w("")
    w("| Metric | p50 | p95 | max |")
    w("|---|---|---|---|")
    w(f"| PSI some avg60 (%) | {pct(some60, 50):.2f} | {s_p95:.2f} | {max(some60):.2f} |")
    w(f"| PSI full avg60 (%) | {pct(full60, 50):.2f} | {f_p95:.2f} | {max(full60):.2f} |")
    w(f"| Swap-in (pages/s) | {pct(rates, 50) if rates else 0.0:.3f} | {r_p95:.3f} | {max(rates, default=0):.3f} |")
    w(f"| Swap used (MiB) | {pct(swap_used, 50)} | {pct(swap_used, 95)} | {max(swap_used)} |")
    w("")
    w(f"Swap-in total over counted intervals: {swapin_pages} pages; mean {r_mean:.3f} pages/s.")
    w("")
    w("## Verdict checks")
    w("")
    w("| Check | Pass | Value |")
    w("|---|---|---|")
    for name, ok, val in checks:
        w(f"| {name} | {'yes' if ok else 'no'} | {val} |")
    w("")
    w("Generated by `infra/memstat/summary.py` from the `carson-memstat.timer` log.")
    print("\n".join(out))


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
