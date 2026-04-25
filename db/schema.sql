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
  venue           TEXT        NOT NULL,                                -- 'cauldron', 'fex', 'tapswap', ...
  category        BYTEA       NOT NULL REFERENCES tokens(category) ON DELETE CASCADE,
  price_sats      DOUBLE PRECISION,                                    -- raw per-smallest-unit price from venue
  tvl_satoshis    NUMERIC(30,0),                                       -- raw locked BCH side (in satoshis); NUMERIC for forward-safety (see token_price_history comment)
  first_listed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (venue, category)
);

CREATE INDEX IF NOT EXISTS token_venue_listings_category_idx ON token_venue_listings (category);

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
