# ADR 0001: Stack — TypeScript, Node, SQLite, no framework

- Status: accepted
- Date: 2026-11-06
- Deciders: Niloufar (product owner), ORCINUS (engineering)

## Context

The weekly-budget app is a real, deployed, single-user web app: add spending
(amount + category + date), weekly summary with an 80% warning, categories,
and history of several weeks, in Persian and English. It must be small enough
to finish 0–100 in one run, and its stack must be the same one ORCINUS's
flagship already proves (TypeScript/JavaScript first proof).

## Decision

- **Language:** TypeScript 6, strict, ES2022, NodeNext. Same as the demo
  scaffold, which is proven (build + lint + typecheck + tests green).
- **Runtime:** Node 24 (v24.22.1 here). No framework: the HTTP server is
  plain `node:http`. The demo's API server already proved this pattern with
  zero production dependencies, and v1 has only 4–5 routes plus static files.
- **Database:** SQLite via the built-in `node:sqlite` (`DatabaseSync`),
  verified working on Node 24.22.1 in this VM (in-memory round-trip: write
  42, read back 42). One file (`data/weekly-budget.db`), WAL mode. No ORM.
- **Frontend:** static HTML/CSS/JS, no framework, served by the same server
  (`public/`). i18n via a strings file (`en`/`fa`), `dir=rtl` for Persian.
- **Tests:** `node:test` (no runner dependency). **Lint:** ESLint +
  typescript-eslint. **Typecheck:** `tsc --noEmit`.
- **Deployment:** Fly.io with a persistent volume for the SQLite file.
  Pricing to be verified at deploy time; deployment needs the owner's Fly
  account (her step, like repo creation).

## Rejected alternatives

- **Express / Fastify:** one dependency for routing we can write in ~50
  lines of plain Node. Reconsider if routes grow past ~10 or we need
  middleware (auth, rate limiting). Adding a framework then is a small,
  reversible change.
- **Next.js / React:** far too heavy for a form + table UI. The frontend
  state rules (server state in the query layer, never mirrored) apply
  without a framework here.
- **better-sqlite3:** a native module needing build tools; `node:sqlite`
  is built in and verified here.
- **Turso / hosted Postgres:** an extra service (and account) for a
  single-user v1. SQLite on a persistent volume is enough; migrate if
  multi-user ever becomes a requirement.
- **Vercel (serverless):** the SQLite file does not persist between
  invocations; it would force a hosted DB. Rejected for v1.
- **Render free tier:** no persistent disk, so SQLite would reset on
  deploy/restart. Rejected for v1.
- **Python:** the flagship's first proof is TypeScript/JavaScript; a
  second stack would double the proof surface.

## Consequences

- Zero production dependencies: the supply-chain surface is minimal
  (only dev tools: TypeScript, ESLint, Stryker).
- The SQLite file is the data: backups mean copying one file; the
  finalize step must include a backup/restore check.
- The server and the frontend ship as one unit (one process, one port),
  which keeps deployment to a single Fly app with one volume.
