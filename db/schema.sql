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

-- Gini coefficient of the holder distribution. 0 = perfectly equal,
-- 1 = one address owns everything. NULL when holder_count < 10
-- (single-digit-holder NFT collections / brand-new tokens look
-- meaninglessly extreme either way). Computed from token_holders by
-- the enrichment worker; refreshed at the same 6h cadence.
ALTER TABLE token_state ADD COLUMN IF NOT EXISTS gini_coefficient REAL;

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
-- re-running `pnpm run db:init` never double-seeds.
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
  details          TEXT        CHECK (details IS NULL OR length(details) <= 2000),
  reporter_email   TEXT        CHECK (reporter_email IS NULL OR length(reporter_email) <= 320),
  reporter_ip      INET,                                              -- for rate-limit debugging + abuse tracking; never rendered publicly
  status           TEXT        NOT NULL DEFAULT 'new'
                                CHECK (status IN ('new','reviewed','actioned','dismissed')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at      TIMESTAMPTZ,
  moderator_note   TEXT                                              -- what the operator did, e.g. "hidden under 'offensive'"
);

CREATE INDEX IF NOT EXISTS token_reports_status_idx   ON token_reports (status, created_at DESC);
CREATE INDEX IF NOT EXISTS token_reports_category_idx ON token_reports (category);

-- Per-IP rate-limit support: lets the application throttle reports
-- per source address efficiently via a (reporter_ip, created_at DESC)
-- range scan. Partial-NULL friendly because INET indexes skip NULLs.
CREATE INDEX IF NOT EXISTS token_reports_ip_recent_idx
  ON token_reports (reporter_ip, created_at DESC)
  WHERE reporter_ip IS NOT NULL;

-- Idempotent additions for already-deployed databases. The CHECKs are
-- attached as named constraints so a future migration can replace them
-- without touching the original CREATE TABLE.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'token_reports'::regclass
          AND conname = 'token_reports_details_len_chk'
    ) THEN
        ALTER TABLE token_reports
          ADD CONSTRAINT token_reports_details_len_chk
          CHECK (details IS NULL OR length(details) <= 2000) NOT VALID;
        ALTER TABLE token_reports VALIDATE CONSTRAINT token_reports_details_len_chk;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'token_reports'::regclass
          AND conname = 'token_reports_email_len_chk'
    ) THEN
        ALTER TABLE token_reports
          ADD CONSTRAINT token_reports_email_len_chk
          CHECK (reporter_email IS NULL OR length(reporter_email) <= 320) NOT VALID;
        ALTER TABLE token_reports VALIDATE CONSTRAINT token_reports_email_len_chk;
    END IF;
END $$;

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
  -- BIGINT for sat-denominated columns. BCH consensus caps total supply
  -- at 21M (~ 2.1e15 sats) — 4 orders of magnitude under i64::MAX (~9.2e18).
  -- Operator-controlled aggregates from a trusted internal indexer; no
  -- need for the NUMERIC defense token_price_history uses against
  -- third-party-supplied values. Keeping BIGINT also matches the
  -- workers/src/pg.rs i64 sqlx binds — a NUMERIC widening here would
  -- silently break the cauldron-stats writer on its next run.
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
  nonce           TEXT        PRIMARY KEY                        -- 256-bit random, base64url
                              CHECK (length(nonce) BETWEEN 32 AND 128),
  cashaddr        TEXT        NOT NULL                           -- the address the user committed to using
                              CHECK (length(cashaddr) BETWEEN 42 AND 80),
  message         TEXT        NOT NULL                           -- exact canonical text the user must sign
                              CHECK (length(message) BETWEEN 32 AND 512),
  -- IP address the challenge was issued to. Verification requires the
  -- same IP — defense against a phished signature being submitted from
  -- the attacker's network. NULL when extraction failed.
  issued_ip       INET,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL,                          -- created_at + 5 min by default
  consumed_at     TIMESTAMPTZ                                    -- set when /api/auth/verify accepts the signature
);

ALTER TABLE auth_challenges ADD COLUMN IF NOT EXISTS issued_ip INET;

CREATE INDEX IF NOT EXISTS auth_challenges_expires_idx ON auth_challenges (expires_at);

-- Hot-path index for the unconsumed lookup. Without it, every auth
-- verify scans the full table once the challenge corpus grows past a
-- few hundred rows. Partial-on-NULL keeps it tiny — only live (not yet
-- consumed) rows are indexed; the cleanup timer + the existing
-- expires_at index handle the wider set.
CREATE INDEX IF NOT EXISTS auth_challenges_unconsumed_idx
  ON auth_challenges (expires_at)
  WHERE consumed_at IS NULL;

CREATE TABLE IF NOT EXISTS sessions (
  id              TEXT        PRIMARY KEY                        -- 256-bit random, base64url; the cookie value
                              CHECK (length(id) BETWEEN 32 AND 128),
  cashaddr        TEXT        NOT NULL REFERENCES users(cashaddr) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL,                          -- 30 days from issue by default
  last_used_at    TIMESTAMPTZ NOT NULL DEFAULT now(),             -- updated lazily (only if > 5min stale)
  user_agent      TEXT        CHECK (user_agent IS NULL OR length(user_agent) <= 512),
  ip              INET                                            -- INET so a malformed value is rejected at the type level
);

CREATE INDEX IF NOT EXISTS sessions_cashaddr_idx ON sessions (cashaddr);
CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions (expires_at);

-- Idempotent migration of the previous TEXT `ip` column to INET. Safe
-- to re-run on already-migrated databases. The conversion is wrapped in
-- a per-row plpgsql function with EXCEPTION handling: any value that
-- doesn't parse as INET (including the literal 'unknown' sentinel from
-- earlier deployments, partial IPv4, IPv6 zone-id forms like `fe80::1%eth0`,
-- or any other garbage) is coerced to NULL instead of aborting the
-- whole migration. A regex-based USING clause was the previous design;
-- it failed because PG evaluates the THEN branch's `::inet` cast for
-- every regex-matching value, and a regex-match-but-cast-fail aborts
-- the entire DO block — blocking deployment on any pre-existing row
-- with garbage like `'cafe'` or `'1.2'`.
CREATE OR REPLACE FUNCTION pg_temp.try_inet(s TEXT) RETURNS INET AS $TRY$
BEGIN
    -- Strip an IPv6 zone id (`%eth0`) before casting — INET doesn't
    -- accept zoned addresses but the un-zoned remainder is valid.
    RETURN regexp_replace(s, '%[^/]*$', '')::inet;
EXCEPTION
    WHEN invalid_text_representation THEN RETURN NULL;
    WHEN data_exception THEN RETURN NULL;
END;
$TRY$ LANGUAGE plpgsql IMMUTABLE;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'sessions' AND column_name = 'ip' AND data_type = 'text'
    ) THEN
        ALTER TABLE sessions
          ALTER COLUMN ip TYPE INET USING pg_temp.try_inet(ip);
    END IF;
END $$;

-- Length CHECKs as named constraints, idempotent for already-deployed DBs.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'sessions'::regclass
          AND conname = 'sessions_id_len_chk'
    ) THEN
        ALTER TABLE sessions
          ADD CONSTRAINT sessions_id_len_chk
          CHECK (length(id) BETWEEN 32 AND 128) NOT VALID;
        ALTER TABLE sessions VALIDATE CONSTRAINT sessions_id_len_chk;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'sessions'::regclass
          AND conname = 'sessions_user_agent_len_chk'
    ) THEN
        ALTER TABLE sessions
          ADD CONSTRAINT sessions_user_agent_len_chk
          CHECK (user_agent IS NULL OR length(user_agent) <= 512) NOT VALID;
        ALTER TABLE sessions VALIDATE CONSTRAINT sessions_user_agent_len_chk;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'auth_challenges'::regclass
          AND conname = 'auth_challenges_nonce_len_chk'
    ) THEN
        ALTER TABLE auth_challenges
          ADD CONSTRAINT auth_challenges_nonce_len_chk
          CHECK (length(nonce) BETWEEN 32 AND 128) NOT VALID;
        ALTER TABLE auth_challenges VALIDATE CONSTRAINT auth_challenges_nonce_len_chk;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'auth_challenges'::regclass
          AND conname = 'auth_challenges_message_len_chk'
    ) THEN
        ALTER TABLE auth_challenges
          ADD CONSTRAINT auth_challenges_message_len_chk
          CHECK (length(message) BETWEEN 32 AND 512) NOT VALID;
        ALTER TABLE auth_challenges VALIDATE CONSTRAINT auth_challenges_message_len_chk;
    END IF;
END $$;

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
-- own. The reverse-direction lookup ("how many wallets watch this
-- category?") is the new per-token detail page's "On N watchlists" pill;
-- the PK can't serve it as a leading-column index, so we add a
-- secondary single-column index on category for that path.
CREATE INDEX IF NOT EXISTS user_watchlist_category_idx
  ON user_watchlist (category);

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

-- ============================================================================
-- Per-wallet daily vote-action counter. One row per (cashaddr, UTC day);
-- count increments on every setVote call (cast, change, retract). Used
-- for two purposes:
--   1. Daily cap of 20 actions/wallet/day — incremented inside setVote's
--      transaction; if returned count > 20, the transaction rolls back
--      and the API returns 429.
--   2. Voter tenure — `tenure_days(cashaddr) = COUNT(*) FROM
--      user_vote_actions WHERE cashaddr = $1` — feeds the hot-ranking
--      voter_weight term `LN(tenure_days + 2) / LN(2)`. Rows are NEVER
--      deleted (cascading from users is fine; never manually pruned).
-- The (cashaddr) leading-column of the PK serves the tenure COUNT(*)
-- query without a separate index. Single-table on purpose: one source
-- of truth for both the daily cap and the tenure lookup.
-- ============================================================================
CREATE TABLE IF NOT EXISTS user_vote_actions (
  cashaddr   TEXT        NOT NULL REFERENCES users(cashaddr) ON DELETE CASCADE,
  day_utc    DATE        NOT NULL,
  count      INT         NOT NULL DEFAULT 0,
  PRIMARY KEY (cashaddr, day_utc)
);

-- ============================================================================
-- Per-(wallet, category) last-action timestamp. Source of truth for the
-- per-target cooldown enforced in setVote — kept SEPARATE from user_votes
-- so a retract (DELETE FROM user_votes) cannot bypass the cooldown by
-- erasing the last voted_at. Touched on every cast/change/retract; never
-- deleted (cascading from users only).
--
-- One row per (cashaddr, category). Bounded by the user's lifetime
-- engagement, which is bounded by the daily vote quota — at 20
-- actions/day, even a long-tenured wallet caps in the low thousands of
-- distinct categories.
-- ============================================================================
CREATE TABLE IF NOT EXISTS user_vote_action_times (
  cashaddr        TEXT        NOT NULL REFERENCES users(cashaddr) ON DELETE CASCADE,
  category        BYTEA       NOT NULL REFERENCES tokens(category) ON DELETE CASCADE,
  last_action_at  TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (cashaddr, category)
);

-- ============================================================================
-- Daily snapshot of the three vote leaderboards (upvoted / downvoted /
-- controversial). Populated by `scripts/snapshot-leaderboards.ts` (one
-- row inserted per day per bucket per top-N category). Drives:
--
--   1. "#N in <bucket>" badges on the per-token detail page (latest-day
--      lookup keyed by (bucket, category)).
--   2. Streak detection — consecutive day_utc rows for the same
--      (bucket, category) inside the top-N window. The page renders
--      "🔥 12-day streak" when the latest run sits at the head of an
--      uninterrupted run.
--   3. Medal counts — lifetime count of top-1 / top-3 / top-5 days per
--      (bucket, category). Surfaced on the detail page as
--      bronze/silver/gold pills.
--
-- Snapshot cadence: daily (UTC midnight via systemd timer or external
-- cron). One row per bucket per top-N — TOP_N_TO_KEEP captured as a
-- script constant. Re-running the same day_utc is idempotent: the PK
-- is (day_utc, bucket, category) and the script does INSERT … ON
-- CONFLICT DO UPDATE.
-- ============================================================================
CREATE TABLE IF NOT EXISTS vote_leaderboard_history (
  day_utc    DATE        NOT NULL,
  bucket     TEXT        NOT NULL CHECK (bucket IN ('upvoted','downvoted','controversial')),
  category   BYTEA       NOT NULL REFERENCES tokens(category) ON DELETE CASCADE,
  rank       INT         NOT NULL CHECK (rank >= 1),
  score      DOUBLE PRECISION NOT NULL,
  up_count   INT         NOT NULL,
  down_count INT         NOT NULL,
  PRIMARY KEY (day_utc, bucket, category)
);

-- Lookup-by-token: streak + medal queries for the detail page filter
-- by (bucket, category) and order by day_utc DESC.
CREATE INDEX IF NOT EXISTS vote_leaderboard_history_category_bucket_day_idx
  ON vote_leaderboard_history (category, bucket, day_utc DESC);

-- Latest-day-per-bucket lookup: "is this token in today's top-N?"
CREATE INDEX IF NOT EXISTS vote_leaderboard_history_bucket_day_rank_idx
  ON vote_leaderboard_history (bucket, day_utc DESC, rank);

ALTER TABLE sync_state ADD COLUMN IF NOT EXISTS last_leaderboard_snapshot_at TIMESTAMPTZ;
ALTER TABLE sync_state ADD COLUMN IF NOT EXISTS last_leaderboard_snapshot_day DATE;

-- ============================================================================
-- CRC-20 detection. CRC-20 is a permissionless naming convention layered on
-- CashTokens — the symbol / decimals / name are encoded inside a 21-byte
-- covenant whose redeem script is revealed in the genesis input of the
-- genesis transaction. A canonical-winner sort
-- (max(commit_block, reveal_block - 20) ASC, category ASC, input_index ASC)
-- picks one winner per symbol.
--
-- One row per CashTokens category whose genesis transaction carries a
-- CRC-20 covenant reveal. Populated incrementally by sync-tail + backfill
-- (which already walk every block since CashTokens activation) and
-- one-shot by sync-crc20-rescan. Canonical-winner resolution per symbol
-- is recomputed by sync-crc20-canonical (hourly + after every reorg).
-- See docs/crc20-plan.md for the full design.
-- ============================================================================
CREATE TABLE IF NOT EXISTS token_crc20 (
  category           BYTEA       PRIMARY KEY REFERENCES tokens(category) ON DELETE CASCADE,
  -- Raw covenant fields. symbol_bytes is authoritative; symbol is its
  -- best-effort UTF-8 decoding when valid, otherwise '0x'||hex(symbol_bytes)
  -- with symbol_is_hex = true.
  symbol_bytes       BYTEA       NOT NULL,
  symbol             TEXT        NOT NULL,
  symbol_is_hex      BOOLEAN     NOT NULL DEFAULT false,
  decimals           SMALLINT    NOT NULL,
  name_bytes         BYTEA       NOT NULL,
  name               TEXT,                                                -- nullable when name_bytes is non-UTF-8; raw bytes always preserved
  recipient_pubkey   BYTEA       NOT NULL,                                -- 33 (compressed) or 65 (uncompressed) bytes
  -- Genesis-input provenance. commit_txid is the prevout of the genesis
  -- input (= category id, since CashTokens defines category id := prevout
  -- txid for vout==0). Stored explicitly for clarity / reorg cleanup.
  commit_txid        BYTEA       NOT NULL,
  commit_block       INTEGER     NOT NULL,                                -- H_commit
  reveal_block       INTEGER     NOT NULL,                                -- H_reveal (= tokens.genesis_block)
  reveal_input_index INTEGER     NOT NULL DEFAULT 0,                      -- almost always 0; tie-break for the canonical sort
  -- Canonical-winner flag. Recomputed per symbol by sync-crc20-canonical
  -- after every detection batch and after every reorg.
  is_canonical       BOOLEAN     NOT NULL DEFAULT false,
  -- Generated column for the canonical-sort key. Postgres ≥ 12 supports
  -- STORED generated columns; the (symbol_bytes, fair_genesis_height,
  -- category, reveal_input_index) index below uses it.
  fair_genesis_height INTEGER GENERATED ALWAYS AS (GREATEST(commit_block, reveal_block - 20)) STORED,
  detected_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Symbol-bucket lookup for canonical resolution and the /crc20 page.
CREATE INDEX IF NOT EXISTS token_crc20_symbol_idx       ON token_crc20 (symbol_bytes);
CREATE INDEX IF NOT EXISTS token_crc20_canonical_idx    ON token_crc20 (is_canonical);
-- Sort key for picking the winner per symbol.
CREATE INDEX IF NOT EXISTS token_crc20_sort_idx
  ON token_crc20 (symbol_bytes, fair_genesis_height, category, reveal_input_index);

ALTER TABLE sync_state ADD COLUMN IF NOT EXISTS last_crc20_run_at TIMESTAMPTZ;
ALTER TABLE sync_state ADD COLUMN IF NOT EXISTS last_crc20_canonical_run_at TIMESTAMPTZ;

-- ============================================================
-- Item #29 — airdrops (2026-05-02).
-- ============================================================
-- Airdrop = one sender sending tokens-they-hold to every wallet
-- that holds another (recipient) token. Built on token_holders.
-- Sender authenticates with wallet-login; per-recipient amount is
-- computed equal-or-weighted at draft time and persisted, then
-- the wizard walks the user through ceil(N / 1000) sequential
-- signing rounds.
--
-- Three additive tables follow the (sender_cashaddr, category)
-- composite-key + cascade-delete pattern from user_watchlist
-- (line 610) / user_mint_sessions (line 689) / user_votes
-- (line 755). Idempotent CREATE TABLE IF NOT EXISTS so re-runs
-- of `npm run db:init` are safe.

CREATE TABLE IF NOT EXISTS airdrops (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_cashaddr     TEXT         NOT NULL REFERENCES users(cashaddr) ON DELETE CASCADE,
  source_category     BYTEA        NOT NULL REFERENCES tokens(category) ON DELETE CASCADE,
  recipient_category  BYTEA        NOT NULL REFERENCES tokens(category) ON DELETE CASCADE,
  mode                TEXT         NOT NULL CHECK (mode IN ('equal','weighted')),
  total_amount        NUMERIC(78,0) NOT NULL,
  holder_count        INTEGER      NOT NULL,
  -- Per-output BCH dust attached to each token UTXO. Default 800
  -- (Panmoni/drop convention); operator can dial to 546-2000 via
  -- the wizard's "Advanced" expander. Stored per-airdrop so the
  -- value is reproducible across the per-tx broadcast loop.
  output_value_sats   INTEGER      NOT NULL CHECK (output_value_sats BETWEEN 546 AND 2000),
  -- Snapshot freshness guard: max(token_holders.snapshot_at) for
  -- the recipient_category at draft time. Re-checked at broadcast;
  -- if newer, halt remaining txs with "holder set has changed,
  -- redraft for the new snapshot". Already-broadcast txs stand.
  holders_snapshot_at TIMESTAMPTZ  NOT NULL,
  state               TEXT         NOT NULL CHECK (state IN ('drafting','signing','broadcasting','complete','failed','partial')),
  tx_count            INTEGER      NOT NULL,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- "Find this user's airdrops, newest first" — drives /airdrops history.
CREATE INDEX IF NOT EXISTS airdrops_sender_idx
  ON airdrops (sender_cashaddr, created_at DESC);

-- Re-entrancy guard: prevent two parallel drafts from the same sender
-- consuming the same funding UTXO. A double-clicked Confirm or two
-- browser tabs would otherwise both try to build a tx against the same
-- coin set. Partial unique index — only enforces while a draft is in
-- flight; completed/failed drafts don't block new ones.
CREATE UNIQUE INDEX IF NOT EXISTS airdrops_one_drafting_per_sender_idx
  ON airdrops (sender_cashaddr) WHERE state IN ('drafting', 'signing');

-- One row per chunk of recipients packed into a single tx. The wizard
-- advances through these in tx_index order; each chunk is independent
-- (mainnet-js's wallet.send picks UTXOs per call, no manual chaining).
CREATE TABLE IF NOT EXISTS airdrop_txs (
  airdrop_id   UUID        NOT NULL REFERENCES airdrops(id) ON DELETE CASCADE,
  tx_index     INTEGER     NOT NULL,                       -- 0-based position in the chain
  txid         BYTEA,                                      -- populated after broadcast
  state        TEXT        NOT NULL CHECK (state IN ('pending','signed','broadcast','failed')),
  fail_reason  TEXT,                                       -- BCHN error message on rejection (NULL when state != 'failed')
  PRIMARY KEY (airdrop_id, tx_index)
);

-- One row per recipient. Same (airdrop_id, recipient) PK shape as
-- user_watchlist's (cashaddr, category). Populated at draft time;
-- txid + vout_index get filled as broadcast progresses.
CREATE TABLE IF NOT EXISTS airdrop_outputs (
  airdrop_id         UUID         NOT NULL REFERENCES airdrops(id) ON DELETE CASCADE,
  recipient_cashaddr TEXT         NOT NULL,                 -- bare-form to match token_holders.address
  amount             NUMERIC(78,0) NOT NULL,                -- base units of source-category
  tx_index           INTEGER      NOT NULL,                 -- which chunked tx pays this recipient
  vout_index         INTEGER,                               -- populated after broadcast
  state              TEXT         NOT NULL CHECK (state IN ('pending','broadcast','confirmed','failed')),
  PRIMARY KEY (airdrop_id, recipient_cashaddr)
);
CREATE INDEX IF NOT EXISTS airdrop_outputs_airdrop_idx
  ON airdrop_outputs (airdrop_id, tx_index);
