# Contributing to TokenStork

Thanks for your interest in TokenStork. This guide covers how to set up a local environment, the conventions the codebase follows, and what a good PR looks like.

If you are here to report a bug or suggest a feature, the [issue tracker](https://github.com/Panmoni/tokenstork/issues) is the right place — skip to the [Filing issues](#filing-issues) section.

---

## Ways to contribute

- **File an issue** for a bug, a regression, or a concrete feature request.
- **Open a PR** for a fix, a small feature, or a documentation improvement.
- **Discuss before you build** for anything larger — a UI rework, a new pipeline stage, a new data source. Open an issue first so we can agree on scope before you spend time on it.
- **Add or refine BCMR metadata** — edit [public/.well-known/bitcoin-cash-metadata-registry.json](public/.well-known/bitcoin-cash-metadata-registry.json).

Good first issues are tagged [`good first issue`](https://github.com/Panmoni/tokenstork/labels/good%20first%20issue) when available.

---

## Prerequisites

- **Node.js 22** (tested on 22.22.2).
- **Postgres 17** with the `pg_trgm` extension available (shipped with the stock `postgresql` package on Debian 13+).
- **pnpm 10+**, pinned via the `packageManager` field in `package.json`. Run `corepack enable` once after installing Node 22 and pnpm will auto-activate at the pinned version on first `pnpm` invocation.
- A reachable BCH node is only needed if you plan to run the sync workers. The SvelteKit app runs fine against an empty schema.

---

## Local setup

```
git clone https://github.com/Panmoni/tokenstork.git
cd tokenstork
pnpm install --frozen-lockfile

createdb tokenstork
export DATABASE_URL="postgres:///tokenstork"
pnpm run db:init

pnpm run dev           # http://localhost:5173
```

Optional environment variables (all read by the app; all safe to leave unset):

- `CRYPTO_COMPARE_KEY` — unlocks `/api/bchPrice`.
- `FEAR_AND_GREED_API_KEY` — unlocks `/api/fearAndGreed`.

For worker development you will additionally need `BCHN_RPC_URL`, `BCHN_ZMQ_URL`, and `BLOCKBOOK_URL`.

---

## Before opening a PR

Run both of these and make sure they pass:

```
pnpm run check        # svelte-check + tsc
pnpm run build        # production build
```

If you touched worker code under [scripts/](scripts/) or [lib/](lib/):

```
pnpm run typecheck   # scripts/tsconfig.json
```

If you changed the schema in [db/schema.sql](db/schema.sql), confirm it still applies cleanly on an empty database and on a database that already has the previous version (the file is idempotent by design — please keep it that way).

---

## Code style

The codebase is deliberately terse. A few things that come up often in review:

- **Comments explain *why*, not *what*.** Well-named identifiers already tell the reader what code does. Write a comment when there is a hidden constraint, a workaround for a known bug, or an invariant a future reader would otherwise miss. Do not write comments that narrate the diff ("added for X", "fix for issue #42") — that belongs in the commit message.
- **No speculative abstractions.** Three similar lines beats a premature helper. Build the abstraction when the third caller actually shows up.
- **No error handling for impossible cases.** Trust internal callers and framework guarantees. Validate at system boundaries — user input, external APIs, BCMR payloads, chain data — and nowhere else.
- **Preserve `NUMERIC(78,0)` precision.** Supply and balance columns hold values larger than `Number.MAX_SAFE_INTEGER`. Stringify at the API boundary. If you find yourself writing `Number(row.current_supply)`, stop.
- **Respect the `BYTEA` boundary.** `category` and `*_txid` columns are raw 32-byte `BYTEA`. Hex encode only when crossing into JSON responses. The helpers in [src/lib/server/db.ts](src/lib/server/db.ts) exist for this.
- **All outbound HTTP goes through `timedFetch`.** See [src/lib/server/fetch.ts](src/lib/server/fetch.ts). External calls without an explicit timeout are a reliability bug.
- **Server-only code lives under `src/lib/server/`.** SvelteKit refuses to bundle it into the client, which is exactly what we want for DB credentials and upstream API keys.

---

## Commits

TokenStork uses [Conventional Commits](https://www.conventionalcommits.org/) with scopes. Look at recent `git log` output for the house style. Examples from the tree:

```
feat(sveltekit): build directory home with Postgres-backed SSR loader
fix(format): harden IPFS URL fallthrough and preserve NUMERIC precision
infra(caddy): switch Caddyfile to Cloudflare Origin Certificate path
chore(deps): regenerate lockfile under pnpm 10
docs(todo): note cloudflare + DNS actions for tokenstork.com
```

Guidelines:

- **Subject in the imperative** ("add X", not "added X" or "adds X").
- **Keep the subject under 72 characters.** Detail goes in the body.
- **One logical change per commit.** If your PR touches unrelated files, split it.
- **The body explains *why*.** Surrounding context, the trade-off considered, the bug this addresses — whatever a reviewer a year from now will need.

Scopes in active use include: `sveltekit`, `infra`, `caddy`, `api`, `deps`, `repo`, `gitignore`, `format`, `theme`, `nav`, `errors`, `directory`, `server`. Add a new scope if none of these fit.

---

## Pull requests

1. **Fork and branch.** Work off a topic branch named for the change (`fix/ipfs-fallthrough`, `feat/nft-tab`). The project branches off `main`.
2. **Keep PRs small and focused.** Reviewers can spot regressions in 50 lines much more reliably than in 500.
3. **Write a real description.** What does this change? Why is it needed? What did you consider and reject? A PR description that is just the commit subject will be asked to expand.
4. **Link the issue** the PR closes (`Closes #123`) when one exists.
5. **Include a test plan.** Even a three-bullet manual checklist is enough for a UI change ("directory loads, search returns matches, token detail renders").
6. **Do not mix formatting churn with logic changes.** Run the formatter as its own commit if needed.
7. **Rebase, don't merge.** Keep branch history linear against `main`.

---

## Filing issues

**Bugs:**

- What happened.
- What you expected to happen.
- Steps to reproduce — ideally a URL on `tokenstork.com` or a minimal command sequence locally.
- Your environment (OS, browser for UI bugs; Node + Postgres versions for backend bugs).

**Feature requests:**

- The problem you are trying to solve. Not the solution you have in mind.
- Who benefits.
- Whether this fits TokenStork's scope (a CashToken directory and explorer) or is better suited to a different project.

**Security issues:** do **not** file public issues for security vulnerabilities. Email <security@panmoni.com> instead.

---

## Scope and roadmap

The near-term, version-by-version roadmap lives in [TODO](TODO). The architectural plan and the VPS runbook live in [docs/cashtoken-index-plan.md](docs/cashtoken-index-plan.md). If your idea does not obviously fit either document, open an issue to discuss before writing code.

TokenStork deliberately does **not** depend on Chaingraph, third-party BlockBook instances, or any other external blockchain indexer. PRs that reintroduce such a dependency will not be merged. BCMR feeds and the Cauldron price endpoint are the only external HTTP calls in the pipeline, and both are narrowly scoped.

---

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE) that covers the project.
