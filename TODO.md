# TODO

Planning docs: docs/cashtoken-index-plan.md · docs/bcmr-publish-plan.md ·
docs/tokenization-mega-plan.md · docs/enrich-event-driven-design.md

---

## P0 — Tame carson resource usage (stop workers jamming the box)

Recurring problem: background workers peg BlockBook + the whole box at ~1000% CPU
/ swap-thrash for HOURS, with no guardrail and no alert (3 incidents in 2 days:
sync-enrich full re-derive, enrich-seed full sweep ×2, sync-bcmr-onchain 50-hop
walks). Systemic root: no shared budget on BlockBook load, and BlockBook's ~24G
working set sits at the 32G box ceiling, so any sustained load tips it. One cron
worker must never be able to monopolize the box.

- [x] **Load/iowait watchdog → REPORT_WEBHOOK** so a pegged box alerts in minutes,
      not discovered via `top` hours later. (Pairs with the REPORT_WEBHOOK_URL
      operator task below.)
- [x] **Serialize heavy workers** — systemd `Conflicts=` between long sweeps
      (sync-enrich ↔ enrich-seed). Hourly sync-bcmr-onchain serialised via the
      advisory lock, not Conflicts= (avoids mid-sweep kill). Implemented 2026-06-18.

Proper fix:
- [x] **Global BlockBook query budget across ALL workers** — Postgres advisory
      lock key 987654321 serialises every BlockBook HTTP call across ALL processes
      (Rust workers + SvelteKit server). Pacing: 3 req/s per process
      (`BLOCKBOOK_MAX_RPS=3` in /etc/tokenstork/env, 2026-06-19). CPUQuota=600%
      on blockbook-bcash caps RocksDB at 6 cores. SvelteKit authchain walks capped
      at 15 hops (was 50). Elimination of per-page double-fetch in
      walk_category_utxos (now N+1, was 2N). BlockBook restart 2026-06-19 flushed
      5 days of RocksDB compaction debt (load 8.75 → 2.43). Implemented 2026-06-18.
- [ ] **Right-size BlockBook** — cap RocksDB/working set, add RAM, or accept heavy
      bursts must be gentle. `MemorySwapMax=4G` is containment, not a fix.
      (CPUQuota=600% added 2026-06-18 — caps the CPU dimension but not the memory
      pressure root cause.)
- [ ] **Shared cross-process token-bucket** — replace per-process `BLOCKBOOK_MAX_RPS`
      pacing with a single rate limiter shared across all worker processes + the
      SvelteKit server. Today N concurrent workers at 3 req/s each deliver 3N req/s
      aggregate to BlockBook; the pg advisory lock serialises calls but doesn't rate-
      limit. Simplest single-machine impl: a `pg_advisory_lock(key)` held for
      `1/max_rps` seconds before every BlockBook HTTP call, or a lockfile with
      fcntl-based timing. Escalate if load climbs back above 5 after the
      2026-06-19 restart + RPS=3 change.
- [ ] **Keep moving heavy derivation OFF BlockBook** — event-driven enrichment did
      it (reads BCHN blocks); audit bcmr-onchain `get_tx?spending` + app
      wallet/authchain calls next. (2026-06-18: advisory lock + reduced MAX_HOPS
      mitigate but don't eliminate this load.)

---

## P1 — Event-driven enrichment: cutover + follow-ups

Built, shadow-running, delta-validated vs BCHN; authoritative `token_state` path
untouched (enrich timer disabled). Context: docs/enrich-event-driven-design.md,
memory `project_blockbook_swap_thrash`.

- [x] **Phase 4: reorg unwind** — fork detection in sync-tail unwinds
      `live_token_utxo` + CRC-20 on mismatch.
- [ ] **Phase 4: cutover** — flip the authoritative writer from `enrich` to the
      Pass-6 delta path (hard-fail; write token_state/holders/nfts). Gate on a few
      days of clean shadow bake.
- [ ] **Rework reconciliation/bootstrap to SUBSET-based walks** — NEVER full-sweep
      (a full 17.5k-category BlockBook walk churns BlockBook till restart, 2×
      confirmed). Bounded subset per run, paced. (Overlaps P0.)
- [ ] **Completeness check** — confirm `live_token_utxo` isn't MISSING live UTXOs
      (gettxout only proved no STALE rows). Oracle = BCHN `gettxout`, NOT BlockBook
      (its spent index lags ~20min post-restart).
- [ ] **Post-cutover cleanup** — drop `sync-tail.service.d/shadow.conf`, remove the
      Pass-6 shadow-compare branch, delete/repurpose the disabled
      `sync-enrich.timer`.
- [ ] **Seed the ~560 categories the 2026-06-15 bootstrap stall skipped** (subset
      run). Most no-row categories are correctly fully-burned; seed the genuine
      remainder only.

---

## P1 — BCMR authchain walker (sync-bcmr-onchain) CPU

While running it pins BlockBook at ~6 cores: many authchain walks hit
`max_hops=50` (dust-attacked/runaway chains) → 50 `get_tx?spending=true` calls
per category, re-walked every >72h-stale tick. Context: memory
`project_bcmr_walker_staleness`, `project_blockbook_quirks`.

- [ ] **Persist a per-category max_hops / last-known-head marker** so a known
      runaway authchain is skipped or resumed-from-head, not re-walked from genesis
      every tick.
- [x] **Lower `BCMR_ONCHAIN_MAX_HOPS`** 50 → 15 (legit authchains are 1-5).
- [ ] **Investigate a cheaper spending lookup** — the walk only needs
      `vout[0].spentTxId` but `?spending=true` computes it for all outputs.
---

## Product backlog

- [ ] Operational hardening (see P0 above for the concrete version)
- [ ] Long-horizon charts on the token detail page
- [ ] Token claim / management
- [ ] One-click "submit to TokenStork BCMR registry" (replacement for OTR mirror)
- [ ] BCMR support workflow for existing-but-unregistered tokens
- [ ] Regular sync of TokenStork BCMR with OTR
- [ ] Better Tapswap / Fex / Cauldron logos
- [ ] Transfer `tokenstork.com` to Cloudflare as registrar
- [ ] `docs/runbook.md` — failure-mode recipes for the tired-3am self
- [ ] Bump `package.json` to `0.2.0` once accounts + persistence ships
- [ ] SEO / content operation?
- [ ] i18n
- [ ] Commenting and discussions?
- [ ] Guidance on where to buy BCH and what wallet to use

---

## Operator (carson)

- [ ] Test minting page, all 3 modes
- [ ] Test airdrops
- [ ] Smoke-test the airdrop wizard end-to-end on mainnet with the operator
      wallet: low-stakes test category, 5-10 holders, sign-and-broadcast, confirm
      recipients land in token_holders. Confirm the multi-tx case too — a 600+
      holder category, verify chunk K+1 builds against fresh BlockBook UTXOs after
      K confirms. (NOTE: token_holders refresh path is changing — enrich timer is
      disabled pending the event-driven cutover; adjust this test accordingly.)
- [ ] Pick `REPORT_WEBHOOK_URL` (Discord / ntfy / TG bot) + add to
      `/etc/tokenstork/env`; redeploy. Optional `REPORT_WEBHOOK_SECRET`.
- [ ] Dismiss the deploy-smoke test report:
      ```sql
      UPDATE token_reports SET status='dismissed', reviewed_at=now(),
                                moderator_note='deploy smoke test'
       WHERE details = 'deploy smoke test — please ignore';
      ```
      
      
      Why is price the last thing to load on individual inner token pages and why so slow?
      
      link "via Cauldron" on inner token page to https://app.cauldron.quest/, they deserve that
      
a problem with bcmr is that people can change the metadata on the token and it can tank the whole recognizability etc of the token.

what kind of caching could we implement to make static data and skeletons load super super fast so can concentrate more resources on the hydration of the website with super up to date data

SEO pass

marketing machine

unique and interesting tokenization tools

unique and interesting distribution tools to get more holders

> Bitcoin Cash Node (BCHN) — the archival full node underpinning every on-chain read

update this to note it is a fork of Bitcoin ABC node AND a fork of the original Bitcoin node, all with minor pages, honoring the long legacy of Bitcoin development etc.

on https://tokenstork.com/learn, make the links more visible perhaps with underlining or something

update https://tokenstork.com/roadmap, remove stuff that is done

when qr033df3ym99dqru8a6gtwfus8t8g9w5lsve42m0df is logged in, treat that address as the admin
