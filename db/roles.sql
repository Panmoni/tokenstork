-- Least-privilege DB roles for tokenstork.
--
-- Apply once per deployment, BEFORE pointing the app or workers at the
-- DB. Idempotent — every CREATE ROLE / GRANT is gated on existence.
--
-- Roles:
--   tokenstork_owner   - DDL + ownership of every object. The migration
--                        connection (`pnpm run db:init`) uses this role.
--                        Never used by long-running services.
--   tokenstork_app     - DML on user-facing tables. The SvelteKit
--                        process (DATABASE_URL) uses this role. Cannot
--                        DROP, CREATE, or ALTER anything.
--   tokenstork_worker  - DML on ingest tables. The Rust workers
--                        (sync-tail, sync-bcmr, sync-icons, etc.) use
--                        this role. Read-only on user/auth tables;
--                        write on chain-derived state.
--
-- Boundary:
--   - tokenstork_app NEVER has access to chain-ingest write paths
--     (a SQLi in the SvelteKit process can't rewrite chain history).
--   - tokenstork_worker NEVER has access to user_* / sessions /
--     auth_challenges / token_reports (a compromised worker can't
--     grant itself an authenticated session or rewrite reports).
--   - Both can SELECT every public table. Reads are not the threat.
--
-- Cleanup operator workflow (one-time):
--   1. Create the roles below.
--   2. Re-deploy schema as tokenstork_owner so it ends up the owner.
--   3. Update env: DATABASE_URL → tokenstork_app, MIGRATIONS_DATABASE_URL
--      → tokenstork_owner, the per-worker DATABASE_URL → tokenstork_worker.
--   4. Restart services.
--
-- Future-table policy: ALTER DEFAULT PRIVILEGES below grants the right
-- access on every NEW table created by tokenstork_owner — no need to
-- re-run grants when adding a table later.

-- Passwords come from environment / vault — this file uses placeholders
-- so it can be committed safely. Replace with `\password rolename` in
-- psql or set via `ALTER ROLE ... WITH PASSWORD ...` from secrets.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tokenstork_owner') THEN
        CREATE ROLE tokenstork_owner WITH LOGIN PASSWORD 'CHANGEME_OWNER';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tokenstork_app') THEN
        CREATE ROLE tokenstork_app WITH LOGIN PASSWORD 'CHANGEME_APP';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tokenstork_worker') THEN
        CREATE ROLE tokenstork_worker WITH LOGIN PASSWORD 'CHANGEME_WORKER';
    END IF;
END $$;

-- Reads on public schema for both runtime roles. Writes are scoped per
-- table below.
GRANT USAGE ON SCHEMA public TO tokenstork_app, tokenstork_worker;

-- Default privileges for objects future-created by tokenstork_owner.
-- Without these, every new table requires a manual GRANT after
-- migration; this lets us keep schema.sql as the single source of
-- truth.
ALTER DEFAULT PRIVILEGES FOR ROLE tokenstork_owner IN SCHEMA public
    GRANT SELECT ON TABLES TO tokenstork_app, tokenstork_worker;
ALTER DEFAULT PRIVILEGES FOR ROLE tokenstork_owner IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO tokenstork_app, tokenstork_worker;

-- Read-only on every existing table for both runtime roles. The DML
-- below tightens that to specific tables for each.
GRANT SELECT ON ALL TABLES IN SCHEMA public TO tokenstork_app, tokenstork_worker;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO tokenstork_app, tokenstork_worker;

-- ---------------------------------------------------------------------
-- tokenstork_app — user-facing DML.
-- The SvelteKit process touches these:
--   users / sessions / auth_challenges     (auth flow)
--   user_watchlist / user_votes            (UI state)
--   user_vote_actions                      (vote-quota counter)
--   user_mint_sessions                     (mint wizard)
--   token_reports                          (report-this-token form)
-- It must NOT write any chain-state table.
-- ---------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON
    users,
    sessions,
    auth_challenges,
    user_watchlist,
    user_votes,
    user_vote_actions,
    user_vote_action_times,
    user_mint_sessions,
    token_reports
TO tokenstork_app;

-- token_reports.id is BIGSERIAL — INSERTs need USAGE on the sequence.
GRANT USAGE ON SEQUENCE token_reports_id_seq TO tokenstork_app;

-- ---------------------------------------------------------------------
-- tokenstork_worker — chain-ingest DML.
-- The Rust workers touch these:
--   tokens / token_metadata / token_state    (core indexer state)
--   token_holders / nft_instances            (per-token snapshots)
--   token_venue_listings / token_price_history (DEX listings)
--   token_crc20                              (CRC-20 detection)
--   tapswap_offers                           (P2P listings)
--   blocks                                   (per-block economics)
--   sync_state                               (worker bookkeeping)
--   cauldron_global_stats                    (cached aggregates)
--   icon_moderation / icon_url_scan          (icon safety pipeline)
-- It must NOT write user data.
-- ---------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON
    tokens,
    token_metadata,
    token_state,
    token_holders,
    nft_instances,
    token_venue_listings,
    token_price_history,
    token_crc20,
    tapswap_offers,
    blocks,
    sync_state,
    cauldron_global_stats,
    icon_moderation,
    icon_url_scan,
    vote_leaderboard_history
TO tokenstork_worker;

-- The worker also runs the auth-cleanup binary, which needs DELETE on
-- expired sessions and auth_challenges — narrowly scoped, no SELECT
-- of cookie material is required for the cleanup itself.
GRANT DELETE ON sessions, auth_challenges TO tokenstork_worker;

-- ---------------------------------------------------------------------
-- Object ownership transfer. Re-run when adding tables; this hands
-- every existing public table to tokenstork_owner so future ALTER /
-- DROP only succeeds via that role.
-- ---------------------------------------------------------------------
DO $$
DECLARE
    obj record;
BEGIN
    FOR obj IN
        SELECT tablename FROM pg_tables WHERE schemaname = 'public'
    LOOP
        EXECUTE format('ALTER TABLE public.%I OWNER TO tokenstork_owner', obj.tablename);
    END LOOP;
    FOR obj IN
        SELECT sequencename FROM pg_sequences WHERE schemaname = 'public'
    LOOP
        EXECUTE format('ALTER SEQUENCE public.%I OWNER TO tokenstork_owner', obj.sequencename);
    END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- Defensive REVOKE: prevent the legacy single-superuser pattern from
-- silently re-emerging. After running this file, the only roles that
-- can DDL public objects are tokenstork_owner + actual superusers.
-- ---------------------------------------------------------------------
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT CREATE ON SCHEMA public TO tokenstork_owner;
