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
  tvl_satoshis    BIGINT,                                              -- raw locked BCH side (in satoshis) from venue
  first_listed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (venue, category)
);

CREATE INDEX IF NOT EXISTS token_venue_listings_category_idx ON token_venue_listings (category);

-- ============================================================================
-- Single-row sync bookkeeping. Replaces the old __sync_info hack that stuffed
-- sync state into a fake tokens row.
-- ============================================================================
CREATE TABLE IF NOT EXISTS sync_state (
  id                    SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  backfill_complete     BOOLEAN     NOT NULL DEFAULT false,
  backfill_through      INTEGER,                                       -- highest block the backfill worker has covered
  tail_last_block       INTEGER,                                       -- highest block the tail worker has scanned
  last_tail_run_at      TIMESTAMPTZ,                                   -- every tail poll tick updates this (even when no new blocks)
  last_enrich_run_at    TIMESTAMPTZ,
  last_verify_run_at    TIMESTAMPTZ,
  last_bcmr_run_at      TIMESTAMPTZ,                                   -- last Phase 4b BCMR-hydration pass
  last_cauldron_run_at  TIMESTAMPTZ,                                   -- last Phase 4d Cauldron-listings pass
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Additive columns for deployments that were brought up before these landed.
-- Idempotent — safe to re-run.
ALTER TABLE sync_state ADD COLUMN IF NOT EXISTS last_bcmr_run_at     TIMESTAMPTZ;
ALTER TABLE sync_state ADD COLUMN IF NOT EXISTS last_tail_run_at     TIMESTAMPTZ;
ALTER TABLE sync_state ADD COLUMN IF NOT EXISTS last_cauldron_run_at TIMESTAMPTZ;

-- Ensure the singleton row exists on first deploy.
INSERT INTO sync_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
