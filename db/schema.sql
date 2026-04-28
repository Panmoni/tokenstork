-- tokenstork schema
-- Deploy with: psql "$DATABASE_URL" -f db/schema.sql
-- Idempotent: safe to re-run. No migrations framework until we need multi-step changes.

-- For LOWER(symbol) and trigram search on name.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================================================
-- Canonical category record: one row per CashToken category ever seen on-chain.
-- Populated by scripts/backfill-from-bchn.ts and scripts/tail-from-bchn.ts.
-- ============================================================================
CREATE TABLE IF NOT EXISTS tokens (
  category         BYTEA PRIMARY KEY,                                  -- 32-byte category id (genesis txid, raw bytes)
  token_type       TEXT NOT NULL CHECK (token_type IN ('FT','NFT','FT+NFT')),
  genesis_txid     BYTEA NOT NULL,                                     -- txid where this category first appeared in an output
  genesis_block    INTEGER NOT NULL,                                   -- block height of first appearance
  genesis_time     TIMESTAMPTZ NOT NULL,                               -- block timestamp of first appearance
  first_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),                 -- when our indexer first wrote the row
  discovery_source TEXT NOT NULL CHECK (discovery_source IN ('bchn','manual'))
);

CREATE INDEX IF NOT EXISTS tokens_type_idx          ON tokens (token_type);
CREATE INDEX IF NOT EXISTS tokens_genesis_block_idx ON tokens (genesis_block);
-- Range scans on genesis_time power the "New in 24h / 7d / 30d" counters
-- rendered on every layout load + the /stats page. genesis_time is the
-- chain block timestamp (when the token was actually minted), not our
-- indexer's write time.
CREATE INDEX IF NOT EXISTS tokens_genesis_time_idx  ON tokens (genesis_time DESC);

-- ============================================================================
-- BCMR-derived metadata: name, symbol, icon, etc. Latest revision per category.
-- Populated by scripts/enrich-from-blockbook.ts (BlockBook-parsed BCMR) and by
-- a future BCMR-registry-polling worker.
-- ============================================================================
CREATE TABLE IF NOT EXISTS token_metadata (
  category        BYTEA PRIMARY KEY REFERENCES tokens(category) ON DELETE CASCADE,
  name            TEXT,
  symbol          TEXT,
  decimals        SMALLINT NOT NULL DEFAULT 0,
  description     TEXT,
  icon_uri        TEXT,
  bcmr_revision   TIMESTAMPTZ,                                         -- revision timestamp from the BCMR json itself
  bcmr_source     TEXT,                                                -- 'paytaca' | 'otr' | 'blockbook' | 'local' | ...
  fetched_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS token_metadata_symbol_idx ON token_metadata (LOWER(symbol));
CREATE INDEX IF NOT EXISTS token_metadata_name_trgm  ON token_metadata USING gin (name gin_trgm_ops);

-- ============================================================================
-- Current on-chain state: supply, burn status, etc. Refreshed periodically by
-- scripts/enrich-from-blockbook.ts. Authoritative for "is this token still
-- alive?" questions.
-- ============================================================================
CREATE TABLE IF NOT EXISTS token_state (
  category           BYTEA PRIMARY KEY REFERENCES tokens(category) ON DELETE CASCADE,
  current_supply     NUMERIC(78,0) NOT NULL DEFAULT 0,                 -- sum of fungible_token_amount across live UTXOs
  live_utxo_count    INTEGER NOT NULL DEFAULT 0,
  live_nft_count     INTEGER NOT NULL DEFAULT 0,
  holder_count       INTEGER,                                          -- distinct addresses holding this category
  has_active_minting BOOLEAN NOT NULL DEFAULT false,                   -- any UTXO has nft.capability = 'minting'
  is_fully_burned    BOOLEAN NOT NULL DEFAULT false,                   -- live_utxo_count = 0 after a refresh
  verified_source    TEXT NOT NULL CHECK (verified_source IN ('blockbook','bchn')),
  verified_at        TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS token_state_burned_idx ON token_state (is_fully_burned);
CREATE INDEX IF NOT EXISTS token_state_supply_idx ON token_state (current_supply DESC);

-- ============================================================================
-- Holder snapshot: address -> balance per category. Rebuilt in full per
-- category by the enrichment worker (delete all rows for category, re-insert).
-- ============================================================================
CREATE TABLE IF NOT EXISTS token_holders (
  category    BYTEA        NOT NULL REFERENCES tokens(category) ON DELETE CASCADE,
  address     TEXT         NOT NULL,                                   -- BCH cashaddr (without bitcoincash: prefix)
  balance     NUMERIC(78,0) NOT NULL DEFAULT 0,                        -- fungible balance in base units
  nft_count   INTEGER      NOT NULL DEFAULT 0,
  snapshot_at TIMESTAMPTZ  NOT NULL,
  PRIMARY KEY (category, address)
);

CREATE INDEX IF NOT EXISTS token_holders_balance_idx ON token_holders (category, balance DESC);

-- ============================================================================
-- Per-NFT instance: one row per unique (category, commitment) combination.
-- Rebuilt per category by the enrichment worker.
-- ============================================================================
CREATE TABLE IF NOT EXISTS nft_instances (
  category      BYTEA NOT NULL REFERENCES tokens(category) ON DELETE CASCADE,
  commitment    BYTEA NOT NULL,                                        -- up to 40 bytes per CashTokens spec
  capability    TEXT  NOT NULL CHECK (capability IN ('none','mutable','minting')),
  owner_address TEXT,                                                  -- nullable if not held in a standard-address UTXO
  snapshot_at   TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (category, commitment)
);

CREATE INDEX IF NOT EXISTS nft_instances_owner_idx ON nft_instances (owner_address);

-- ============================================================================
-- Per-venue listings: which DEXs / indexers currently list each token and
-- what price / TVL they report. Populated by `sync-cauldron` (and future
-- `sync-fex`, `sync-tapswap`, ...). Raw values from the venue — BCH / USD
-- conversion happens at render time using the live BCH price, so these
-- rows don't go stale just because BCH moved $1.
-- ============================================================================
CREATE TABLE IF NOT EXISTS token_venue_listings (
  venue                TEXT        NOT NULL,                                -- 'cauldron', 'fex', 'tapswap', ...
  category             BYTEA       NOT NULL REFERENCES tokens(category) ON DELETE CASCADE,
  price_sats           DOUBLE PRECISION,                                    -- raw per-smallest-unit price from the canonical (deepest) pool
  tvl_satoshis         NUMERIC(30,0),                                       -- canonical pool's BCH-side reserve in sats; NUMERIC for forward-safety
  -- ----------------------------------------------------------------------
  -- Multi-pool aggregates per (venue, category). The row's price_sats /
  -- tvl_satoshis reflect ONE canonical pool (highest-BCH-reserve), keeping
  -- every directory / arbitrage / detail-page consumer single-row-per-token.
  -- The two columns below summarize the FULL pool population for the same
  -- category — used by the MetricsBar TVL pill so its number matches the
  -- ecosystem-wide /stats card and Cauldron's own indexer total.
  --
  -- Both nullable: NULL means "we don't know". The Fex worker fills both
  -- exactly (it enumerates every pool via scantxoutset). The Cauldron
  -- worker fills pools_total_tvl_sats = tvl_satoshis when the upstream
  -- /cauldron/valuelocked/<cat> endpoint is per-category-aggregated, and
  -- leaves pools_count NULL because no per-category pool-count endpoint
  -- exists today. See docs/cashtoken-index-plan.md "Future: option 3"
  -- entry for the per-pool-row roadmap that would make pools_count
  -- exact for Cauldron too.
  -- ----------------------------------------------------------------------
  pools_count          INTEGER,
  pools_total_tvl_sats NUMERIC(30,0),
  first_listed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (venue, category)
);

CREATE INDEX IF NOT EXISTS token_venue_listings_category_idx ON token_venue_listings (category);

-- Idempotent additions for already-deployed databases.
ALTER TABLE token_venue_listings ADD COLUMN IF NOT EXISTS pools_count          INTEGER;
ALTER TABLE token_venue_listings ADD COLUMN IF NOT EXISTS pools_total_tvl_sats NUMERIC(30,0);

-- ============================================================================
-- Per-venue price/TVL history. Append-only; one row per category per
-- sync-cauldron run. Drives the directory grid's 1h/24h/7d % change
-- columns and the 7-day sparklines. `token_venue_listings` holds the
-- current snapshot (single row per venue/category); this table keeps
-- the time series.
--
-- Retention: at current cadence (~317 listed × 6 runs/day) this is
-- ~57k rows/month → ~700k rows/year, which Postgres happily keeps in
-- RAM and serves from the (category, venue, ts DESC) index without
-- sweat. No pruning today.
--
-- Revisit when any of these hit:
-- (1) we add a second venue writing more than a few hundred rows/hour,
-- (2) the table exceeds ~10M rows (~15 years at current rates),
-- (3) the LATERAL subqueries in /+page.server.ts start showing in
--     the slow-query log.
-- Simple fix when the time comes: `DELETE FROM token_price_history
-- WHERE ts < now() - INTERVAL '90 days'` on a weekly systemd timer.
-- 90 days is 10× the longest window the UI queries (7d), so dropping
-- anything older is safe.
-- ============================================================================
CREATE TABLE IF NOT EXISTS token_price_history (
  category     BYTEA            NOT NULL REFERENCES tokens(category) ON DELETE CASCADE,
  venue        TEXT             NOT NULL,                              -- 'cauldron' today
  ts           TIMESTAMPTZ      NOT NULL DEFAULT now(),
  price_sats   DOUBLE PRECISION NOT NULL,
  -- NUMERIC(30,0) rather than BIGINT for belt-and-braces. BIGINT max is
  -- ~9.2e18 sats ≈ 92 billion BCH, and BCH consensus caps total supply
  -- at 21M — we have 4 orders of magnitude of physical headroom. But:
  -- (a) NUMERIC is practically the same storage cost for small values,
  -- (b) if a Cauldron indexer bug ever reports a garbage 10^20 value we
  -- store it faithfully instead of corrupting the row with a silent
  -- wraparound, and (c) the matching migration lives in the same file
  -- below so an operator-mistaken-rollback can't revert half.
  tvl_satoshis NUMERIC(30,0),
  PRIMARY KEY (category, venue, ts)
);

-- Hot path: last-7d points for a single category (sparkline + window lookups).
CREATE INDEX IF NOT EXISTS token_price_history_category_venue_ts_desc_idx
  ON token_price_history (category, venue, ts DESC);

-- Widen pre-existing deployments where the columns were defined as BIGINT
-- (before 2026-04-24). Both ALTERs are no-ops on fresh databases (types
-- already match). On carson the rewrite is seconds-scoped given the table
-- sizes.
ALTER TABLE token_venue_listings
  ALTER COLUMN tvl_satoshis TYPE NUMERIC(30,0);
ALTER TABLE token_price_history
  ALTER COLUMN tvl_satoshis TYPE NUMERIC(30,0);

-- Seed a single initial data point per currently-listed category from
-- `token_venue_listings`, but only once. Without this the sparklines are
-- empty until the sync-cauldron timer has fired enough times — boring for
-- the first few days post-deploy. Idempotent: the NOT EXISTS guard means
-- re-running `npm run db:init` never double-seeds.
INSERT INTO token_price_history (category, venue, ts, price_sats, tvl_satoshis)
SELECT vl.category, vl.venue, vl.updated_at, vl.price_sats, vl.tvl_satoshis
  FROM token_venue_listings vl
 WHERE vl.price_sats IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM token_price_history h
      WHERE h.category = vl.category AND h.venue = vl.venue
   )
ON CONFLICT DO NOTHING;

-- ============================================================================
-- Moderation blocklist. Operator-maintained. Categories here are filtered
-- from every directory / API / stats query and return 410 Gone on direct
-- URL access. Underlying `tokens` / `token_metadata` / `token_state` rows
-- are untouched — re-admitting a token is a single DELETE.
--
-- Runbook: docs/moderation-runbook.md (gitignored).
-- ============================================================================
CREATE TABLE IF NOT EXISTS token_moderation (
  category         BYTEA       PRIMARY KEY REFERENCES tokens(category) ON DELETE CASCADE,
  reason           TEXT        NOT NULL CHECK (reason IN ('spam','phishing','offensive','fraud','illegal','other')),
  moderator_note   TEXT,                                              -- free-form operator context; never shown to visitors
  hidden_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- User-submitted reports. The public `Report this token` form POSTs here
-- via /api/tokens/<cat>/report. Reports are persisted first; alert dispatch
-- is best-effort (webhook-based — see src/lib/server/reportAlert.ts).
-- The operator triages via `SELECT * FROM token_reports WHERE status = 'new'`
-- and either actions the category into `token_moderation` or dismisses.
-- ============================================================================
CREATE TABLE IF NOT EXISTS token_reports (
  id               BIGSERIAL   PRIMARY KEY,
  category         BYTEA       NOT NULL REFERENCES tokens(category) ON DELETE CASCADE,
  reason           TEXT        NOT NULL CHECK (reason IN ('spam','phishing','offensive','fraud','illegal','other')),
  details          TEXT,                                              -- reporter's free-form note, UI-limited to 2000 chars
  reporter_email   TEXT,                                              -- optional; no SMTP validation beyond length cap
  reporter_ip      INET,                                              -- for rate-limit debugging + abuse tracking; never rendered publicly
  status           TEXT        NOT NULL DEFAULT 'new'
                                CHECK (status IN ('new','reviewed','actioned','dismissed')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at      TIMESTAMPTZ,
  moderator_note   TEXT                                              -- what the operator did, e.g. "hidden under 'offensive'"
);

CREATE INDEX IF NOT EXISTS token_reports_status_idx   ON token_reports (status, created_at DESC);
CREATE INDEX IF NOT EXISTS token_reports_category_idx ON token_reports (category);

-- ============================================================================
-- Tapswap ("MPSW") P2P listings. Populated by `sync-tapswap-backfill` (cold
-- walk blocks 794,520 → tip, oneshot) and `sync-tail` (incremental, piggybacks
-- on the existing tokens walker).
--
-- Each row is one on-chain listing. The listing UTXO is always outputs[0]
-- of the listing tx, so (id = listing_txid) uniquely identifies it.
--
-- Day-one ships with status always 'open' — spend detection (taken / cancelled
-- transitions) is a follow-up commit. Stale "open" rows don't harm queries
-- since partial indexes only cover the open set.
--
-- Protocol reference: mainnet-pat/tapswap-subsquid; verified end-to-end
-- against block 796,000 tx 83628e1a…edc2545f on 2026-04-24.
-- ============================================================================
CREATE TABLE IF NOT EXISTS tapswap_offers (
  id                BYTEA       PRIMARY KEY,                           -- listing tx txid (32 bytes)
  -- "has" side — what the maker is offering (from outputs[0].tokenData):
  has_category      BYTEA,                                              -- null = pure-sats listing
  has_amount        NUMERIC(78,0),                                      -- FT amount; null for NFT or sats-only
  has_commitment    BYTEA,                                              -- NFT commitment
  has_capability    TEXT CHECK (has_capability IN ('none','mutable','minting')),
  has_sats          BIGINT      NOT NULL,                               -- outputs[0].value_satoshis (usually 1000 dust)
  -- "want" side — what the maker wants in return (from OP_RETURN chunks 4-7):
  want_category     BYTEA,
  want_amount       NUMERIC(78,0),
  want_commitment   BYTEA,
  want_capability   TEXT CHECK (want_capability IN ('none','mutable','minting')),
  want_sats         BIGINT      NOT NULL,
  -- Metadata:
  fee_sats          BIGINT      NOT NULL,                               -- OP_RETURN chunk[9]; observed = 3% of want_sats
  maker_pkh         BYTEA       NOT NULL,                               -- raw 20-byte PKH from chunk[8]; UI renders as cashaddr at display time
  listed_block      INTEGER     NOT NULL,
  listed_at         TIMESTAMPTZ NOT NULL,                               -- block timestamp
  -- Lifecycle (day-one: always 'open'; follow-up commit adds transitions):
  status            TEXT        NOT NULL DEFAULT 'open'
                                CHECK (status IN ('open','taken','cancelled')),
  taker_pkh         BYTEA,
  closed_tx         BYTEA,
  closed_at         TIMESTAMPTZ
);

-- Partial indexes — the hot query path is "open listings for a given FT category".
CREATE INDEX IF NOT EXISTS tapswap_offers_has_category_open_idx
  ON tapswap_offers (has_category)
  WHERE status = 'open' AND has_category IS NOT NULL;
CREATE INDEX IF NOT EXISTS tapswap_offers_status_idx
  ON tapswap_offers (status, listed_at DESC);

-- ============================================================================
-- Per-block economics. One row per block from CashToken activation (792,772)
-- forward, populated by `sync-tail`'s fourth walker pass + the one-shot
-- `blocks-backfill` binary that hydrates the historical range. Backs the
-- `/blocks` page (per-block table + headline sparklines).
--
-- Field derivations (all from the verbose `getblock 2` response we already
-- fetch for the tokens / Tapswap walkers — no extra RPC calls):
--   - tx_count           = block.tx.len()
--   - coinbase_sats      = sum of vouts of block.tx[0]   (subsidy + fees)
--   - total_output_sats  = sum of vouts across all txs MINUS coinbase_sats
--                          (the "economic value transferred" lens)
--   - subsidy_sats       = 50 * 1e8 >> (height / 210_000)  (BCH halving)
--   - fees_sats          = coinbase_sats - subsidy_sats
--                          (avoids needing input values)
--   - size_bytes         = block.size
--
-- NUMERIC(30,0) on total_output_sats because a busy block can sum to >
-- i64 across thousands of large outputs. coinbase_sats / subsidy_sats /
-- fees_sats fit BIGINT comfortably (single coinbase output, ≤ 21 M BCH).
-- ============================================================================
CREATE TABLE IF NOT EXISTS blocks (
  height              INTEGER     PRIMARY KEY,
  hash                BYTEA       NOT NULL,
  time                TIMESTAMPTZ NOT NULL,
  tx_count            INTEGER     NOT NULL,
  total_output_sats   NUMERIC(30,0) NOT NULL,
  coinbase_sats       BIGINT      NOT NULL,
  fees_sats           BIGINT      NOT NULL,
  subsidy_sats        BIGINT      NOT NULL,
  size_bytes          INTEGER     NOT NULL,
  -- Raw coinbase scriptSig bytes from block.tx[0].vin[0].coinbase. Used by
  -- /mining for miner-pool attribution via ASCII-substring matching against
  -- well-known pool tags ("ViaBTC", "AntPool", "Foundry USA", etc.). Pre-
  -- 4f-deploy blocks have NULL here until backfill repopulates them. The
  -- column is forward-safe-by-default: a row without coinbase_script_sig
  -- attributes to "Unknown".
  coinbase_script_sig BYTEA
);

-- Window queries on /blocks ("last 7d / 30d / all-time") sort by time DESC
-- and slice. A b-tree on time supports both bounds + ordering in one seek.
CREATE INDEX IF NOT EXISTS blocks_time_idx ON blocks (time DESC);

-- Idempotent column add for already-deployed databases. Safe to re-run.
ALTER TABLE blocks ADD COLUMN IF NOT EXISTS coinbase_script_sig BYTEA;

-- ============================================================================
-- Single-row sync bookkeeping. Replaces the old __sync_info hack that stuffed
-- sync state into a fake tokens row.
-- ============================================================================
CREATE TABLE IF NOT EXISTS sync_state (
  id                              SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  backfill_complete               BOOLEAN     NOT NULL DEFAULT false,
  backfill_through                INTEGER,                              -- highest block the backfill worker has covered
  tail_last_block                 INTEGER,                              -- highest block the tail worker has scanned
  last_tail_run_at                TIMESTAMPTZ,                          -- every tail poll tick updates this (even when no new blocks)
  last_enrich_run_at              TIMESTAMPTZ,
  last_verify_run_at              TIMESTAMPTZ,
  last_bcmr_run_at                TIMESTAMPTZ,                          -- last Phase 4b BCMR-hydration pass
  last_cauldron_run_at            TIMESTAMPTZ,                          -- last Phase 4d Cauldron-listings pass
  last_tapswap_backfill_through   INTEGER,                              -- highest block the Tapswap backfill binary has covered
  last_tapswap_run_at             TIMESTAMPTZ,                          -- last Tapswap backfill / tail upsert
  last_fex_run_at                 TIMESTAMPTZ,                          -- last Phase 4e Fex AMM scan
  updated_at                      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Additive columns for deployments that were brought up before these landed.
-- Idempotent — safe to re-run.
ALTER TABLE sync_state ADD COLUMN IF NOT EXISTS last_bcmr_run_at               TIMESTAMPTZ;
ALTER TABLE sync_state ADD COLUMN IF NOT EXISTS last_tail_run_at               TIMESTAMPTZ;
ALTER TABLE sync_state ADD COLUMN IF NOT EXISTS last_cauldron_run_at           TIMESTAMPTZ;
ALTER TABLE sync_state ADD COLUMN IF NOT EXISTS last_tapswap_backfill_through  INTEGER;
ALTER TABLE sync_state ADD COLUMN IF NOT EXISTS last_tapswap_run_at            TIMESTAMPTZ;
ALTER TABLE sync_state ADD COLUMN IF NOT EXISTS last_fex_run_at                TIMESTAMPTZ;
ALTER TABLE sync_state ADD COLUMN IF NOT EXISTS last_cauldron_stats_run_at     TIMESTAMPTZ;
ALTER TABLE sync_state ADD COLUMN IF NOT EXISTS last_tapswap_spend_backfill_through INTEGER;
ALTER TABLE sync_state ADD COLUMN IF NOT EXISTS last_blocks_backfill_through       INTEGER;
ALTER TABLE sync_state ADD COLUMN IF NOT EXISTS last_blocks_run_at                 TIMESTAMPTZ;

-- Ensure the singleton row exists on first deploy.
INSERT INTO sync_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- Cached aggregates from indexer.cauldron.quest's global endpoints. Populated
-- by `sync-cauldron-stats` on a 30 min cadence. Decoupled from /stats SSR so
-- a public-page hit doesn't pay a network round-trip to a third-party indexer.
--
-- Singleton row (id = 1) holds the latest snapshot. USD values are NOT stored
-- — derived at render time from bch_price × stored sats so a faster-moving
-- BCH price doesn't get pinned to the slower cadence.
-- ============================================================================
CREATE TABLE IF NOT EXISTS cauldron_global_stats (
  id                         SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  tvl_sats                   BIGINT      NOT NULL DEFAULT 0,
  volume_24h_sats            BIGINT      NOT NULL DEFAULT 0,
  volume_7d_sats             BIGINT      NOT NULL DEFAULT 0,
  volume_30d_sats            BIGINT      NOT NULL DEFAULT 0,
  pools_active               INTEGER     NOT NULL DEFAULT 0,
  pools_ended                INTEGER     NOT NULL DEFAULT 0,
  pools_interactions         BIGINT      NOT NULL DEFAULT 0,
  unique_addresses_by_month  JSONB       NOT NULL DEFAULT '[]'::jsonb,
  fetched_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO cauldron_global_stats (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- Authentication: BCH wallet login.
--
-- The whole flow is wallet-signature-based — no email, no password, no OAuth.
-- A user proves they control a cashaddr by signing a server-issued challenge
-- in their wallet using the standard "Bitcoin Signed Message" format that
-- Electron Cash, Cashonize, Paytaca and every other major BCH wallet
-- supports. The server recovers the pubkey from the signature, derives a
-- cashaddr from it, and confirms it matches the claimed address.
--
-- Three tables:
--
--   users             — one row per logged-in cashaddr (PK).
--   auth_challenges   — short-lived nonces; each is single-use and expires
--                       in 5 min. Prevents signature replay.
--   sessions          — opaque random session tokens issued post-verify;
--                       30 day TTL; the session ID is the cookie value.
--
-- Cleanup: expired challenges + sessions are pruned by a periodic VACUUM-
-- adjacent worker (TODO post-ship); for now their indexes filter them out
-- of every hot-path query.
-- ============================================================================
CREATE TABLE IF NOT EXISTS users (
  cashaddr        TEXT        PRIMARY KEY,                       -- canonical "bitcoincash:q..." form
  first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS auth_challenges (
  nonce           TEXT        PRIMARY KEY,                       -- 256-bit random, base64url
  cashaddr        TEXT        NOT NULL,                          -- the address the user committed to using
  message         TEXT        NOT NULL,                          -- exact canonical text the user must sign
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL,                          -- created_at + 5 min by default
  consumed_at     TIMESTAMPTZ                                    -- set when /api/auth/verify accepts the signature
);

CREATE INDEX IF NOT EXISTS auth_challenges_expires_idx ON auth_challenges (expires_at);

CREATE TABLE IF NOT EXISTS sessions (
  id              TEXT        PRIMARY KEY,                       -- 256-bit random, base64url; the cookie value
  cashaddr        TEXT        NOT NULL REFERENCES users(cashaddr) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL,                          -- 30 days from issue by default
  last_used_at    TIMESTAMPTZ NOT NULL DEFAULT now(),             -- touched on every authenticated request
  user_agent      TEXT,
  ip              TEXT                                           -- record-only; consider hashing later for privacy
);

CREATE INDEX IF NOT EXISTS sessions_cashaddr_idx ON sessions (cashaddr);
CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions (expires_at);

-- ============================================================================
-- Wallet-tied watchlist. Composite-keyed (cashaddr, category) so a user's
-- list is read with a single index range scan + a token can never appear
-- twice. Cascading deletes mean: removing a user wipes their list; a
-- moderation-driven token deletion (rare — moderation hides via
-- `token_moderation`, doesn't drop the `tokens` row) cleans the watchlist
-- alongside.
-- ============================================================================
CREATE TABLE IF NOT EXISTS user_watchlist (
  cashaddr   TEXT        NOT NULL REFERENCES users(cashaddr) ON DELETE CASCADE,
  category   BYTEA       NOT NULL REFERENCES tokens(category) ON DELETE CASCADE,
  added_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (cashaddr, category)
);

-- The `(cashaddr)` portion of the PK already serves the "all rows for
-- this user" query — Postgres uses it as a leading-column index on its
-- own. No explicit secondary index needed.

-- ============================================================================
-- Icon safety pipeline (item #22 / docs/icon-safety-plan.md). Two-table
-- split — `icon_moderation` keyed by content hash (one decision per unique
-- image, regardless of how many BCMR URIs serve it) + `icon_url_scan` keyed
-- by URL (what the BCMR worker polls). Issuers reuse icons across categories;
-- a single hash backing ten URIs scans once.
--
-- Default-deny: until `icon_moderation.state='cleared'` for an icon's hash,
-- the UI shows the SVG placeholder. See docs/icon-safety-plan.md.
-- ============================================================================
CREATE TABLE IF NOT EXISTS icon_moderation (
  content_hash   BYTEA       PRIMARY KEY,                     -- sha256 of fetched bytes
  source_url     TEXT        NOT NULL,                        -- first URL we saw this hash at (informational)
  state          TEXT        NOT NULL CHECK (state IN ('pending','cleared','blocked','review')),
  scanned_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  nsfw_score     REAL,                                        -- NULL until NSFW check runs
  block_reason   TEXT        CHECK (block_reason IN ('csam','adult','oversize','fetch_failed','unsupported_format') OR block_reason IS NULL),
  bytes_size     INTEGER,                                     -- audit / quota; NOT the bytes themselves
  -- State-machine consistency: only `blocked` rows may carry a block_reason,
  -- everything else MUST have block_reason NULL. Defense-in-depth — the
  -- worker code respects this invariant today, but the constraint stops a
  -- future buggy code path or a manual operator INSERT from corrupting
  -- the table with `state='cleared' AND block_reason='adult'`-style rows.
  CHECK (
    (state = 'blocked' AND block_reason IS NOT NULL)
    OR (state IN ('pending', 'cleared', 'review') AND block_reason IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS icon_moderation_state_idx
  ON icon_moderation (state, scanned_at DESC);

CREATE TABLE IF NOT EXISTS icon_url_scan (
  icon_uri        TEXT        PRIMARY KEY,                    -- raw BCMR URI (re-fetch-on-change works via natural URL key)
  content_hash    BYTEA       REFERENCES icon_moderation(content_hash),
  last_fetched_at TIMESTAMPTZ,
  fetch_error     TEXT                                         -- last fetch failure, NULL on success
);

-- Hot path: pending + retry queue. Partial index keeps it tiny since the
-- happy-path "cleared with successful fetch" rows fall out of scope.
CREATE INDEX IF NOT EXISTS icon_url_scan_pending_idx
  ON icon_url_scan (last_fetched_at NULLS FIRST)
  WHERE content_hash IS NULL OR fetch_error IS NOT NULL;

ALTER TABLE sync_state ADD COLUMN IF NOT EXISTS last_icons_run_at TIMESTAMPTZ;
ALTER TABLE sync_state ADD COLUMN IF NOT EXISTS last_icons_backfill_through INTEGER;

-- ============================================================================
-- Mint sessions — wallet-gated CashTokens minting wizard (item #28).
-- Each row tracks one user's progress through the 5-step mint flow:
-- type → identity → supply → review → sign+broadcast. Resumable across
-- browser refreshes via the wallet-cookie session; the state machine
-- enforces forward-only progression (e.g., 'signed' → 'broadcast'
-- requires the broadcast endpoint to actually fire).
--
-- Bytes-of-icon are NOT stored here. Icon staging lives separately on
-- disk under /var/lib/tokenstork/icon-staging/<session_id>/<filename>;
-- only the path is recorded in `icon_staging_path`. A daily cleanup
-- timer scrubs anything older than 24h.
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS "pgcrypto";  -- gen_random_uuid()

CREATE TABLE IF NOT EXISTS user_mint_sessions (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  cashaddr            TEXT         NOT NULL REFERENCES users(cashaddr) ON DELETE CASCADE,
  state               TEXT         NOT NULL CHECK (state IN ('drafting','signed','broadcast','confirmed','failed','abandoned')),
  token_type          TEXT         CHECK (token_type IN ('FT','NFT','FT+NFT') OR token_type IS NULL),
  ticker              TEXT,
  name                TEXT,
  description         TEXT,
  decimals            SMALLINT     CHECK (decimals IS NULL OR (decimals BETWEEN 0 AND 8)),
  -- FT supply or NFT count (depending on token_type). NUMERIC(78,0) to
  -- match the rest of our supply columns.
  supply              NUMERIC(78,0),
  nft_capability      TEXT         CHECK (nft_capability IN ('none','mutable','minting') OR nft_capability IS NULL),
  nft_commitment      BYTEA,
  -- Path on the server's filesystem to the staged icon (pre-publication).
  -- Cleaned up after 24h by the icon-staging cleanup timer.
  icon_staging_path   TEXT,
  -- Populated when broadcast (step 5).
  genesis_txid        BYTEA,
  -- Populated by the wizard immediately post-broadcast (the category id
  -- is deterministic from the funding outpoint, no need to wait for
  -- chain confirmation). NOT a foreign key into `tokens(category)` —
  -- the tokens row only appears after sync-tail processes the genesis
  -- tx, ~1 block later, so a FK here would force an UPDATE-fail right
  -- when the wizard wants to record success. Informational coupling
  -- only; if a token row vanishes (rare — moderation hides via
  -- token_moderation, doesn't drop), the session row keeps its
  -- categoryHex orphaned, which is harmless.
  category            BYTEA,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_mint_sessions_user_idx
  ON user_mint_sessions (cashaddr, state);
CREATE INDEX IF NOT EXISTS user_mint_sessions_genesis_txid_idx
  ON user_mint_sessions (genesis_txid)
  WHERE genesis_txid IS NOT NULL;

-- Defensive drop of an earlier-deployment FK on user_mint_sessions.category
-- (was REFERENCES tokens(category) ON DELETE SET NULL). The wizard sets
-- categoryHex immediately post-broadcast — before sync-tail creates the
-- tokens row — so the FK caused a guaranteed UPDATE failure right when
-- the wizard recorded success. Idempotent: if the constraint was never
-- created (fresh deploy after this edit), this is a no-op.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'user_mint_sessions'::regclass
          AND conname = 'user_mint_sessions_category_fkey'
    ) THEN
        ALTER TABLE user_mint_sessions DROP CONSTRAINT user_mint_sessions_category_fkey;
    END IF;
END $$;

-- ============================================================================
-- User up/down votes on tokens. One vote per (cashaddr, category) pair —
-- changing direction overwrites the row, retracting deletes it. Cascading
-- deletes keep votes consistent if a user or token is removed.
--
-- Live aggregation via COUNT(*) FILTER on the (category, vote) index. At
-- expected scale (~10–20k tokens, single-digit votes each near-term) the
-- aggregation join cost is negligible; denormalising into token_state is
-- a follow-up only if a query plan shows it as the bottleneck.
-- ============================================================================
CREATE TABLE IF NOT EXISTS user_votes (
  cashaddr   TEXT        NOT NULL REFERENCES users(cashaddr) ON DELETE CASCADE,
  category   BYTEA       NOT NULL REFERENCES tokens(category) ON DELETE CASCADE,
  vote       TEXT        NOT NULL CHECK (vote IN ('up','down')),
  voted_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (cashaddr, category)
);

CREATE INDEX IF NOT EXISTS user_votes_category_vote_idx
  ON user_votes (category, vote);
