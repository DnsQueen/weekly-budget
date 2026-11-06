# Stage 40 verification report — weekly-budget

Scope: the security and health stage (40–49) on the tree at local commit
`92f0181` (Stage 30 closed). Two reviews ran: the `security-review`
skill, applied by an independent reviewer that read only the code, and
my own read of the same tree. The `monitoring` skill supplied the health
half: `/livez` + `/readyz`. Nothing was weakened to pass.

## 1. Independent security review

Verdict: **PASS WITH LIMITATIONS** — no blocking findings. Nine
non-blocking findings, each verified against the code (including two
runtime probes). The limitations are the four checks that could not run
(see §5).

| # | Finding (file:line) | Disposition |
| - | ------------------- | ----------- |
| F1 | 500 echoes internal error text (`src/server.ts:194`); the 422 path echoes raw SQLite messages too (`:120`, `:142`) | Fixed (§2) |
| F2 | `amount`/`budget` accept `Infinity` (`src/db.ts:45`, `:79`); the row stores as `amount: null` and the summary silently counts it as 0 | Fixed (§2) |
| F3 | No security headers on any response | Fixed (§2) |
| F4 | Static confinement is a bare prefix match (`src/server.ts:85`); a sibling dir `/app/public-evil/x` passes it | Fixed (§2) |
| F5 | `data/` is not gitignored; the SQLite file is one `git add .` from being committed | Fixed (§2) |
| F6 | Oversized-body rejection does not destroy the request stream (`src/server.ts:46-58`) | Fixed (§2) |
| F7 | The runtime container runs as root (no `USER` in `Dockerfile`) | Fixed (§2) |
| F8 | `.dockerignore` does not exclude `.env`; a local `.env` would land in build-stage image layers | Fixed (§2) |
| F9 | No rate limiting on the anonymous write endpoints backed by a persistent volume | **Deferred to deploy time** (§4) |

My own read confirmed F1, F3, F5, and the missing health endpoints
independently before the review returned. F2 (the `Infinity` hole) was
found by the independent reviewer, not by me — I had read the same
validation code and missed it. F4's flaw I re-verified with my own
probe: `"/app/public-evil/x".startsWith("/app/public")` is `true`.

## 2. Fixes (all in local commit, see §6)

- **F1** — `db.ts` validation now throws a distinct `ValidationError`;
  the POST handlers answer 422 only for it and anything else with a
  generic 500. The outer catch logs the real error server-side
  (`console.error`) and answers `{error: {code: "INTERNAL_ERROR",
  message: "internal error"}}`. No internal text reaches a client.
- **F2** — `addSpending` and `setBudget` reject non-finite amounts
  (`Number.isFinite`), same messages as before. The weekly-summary
  route already had this check; the DB layer now matches it.
- **F3** — every response carries `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, and
  `Content-Security-Policy: default-src 'self'` (API and static alike).
- **F4** — new exported `isPathWithinDir(dir, candidate)`: the candidate
  must equal the directory or start with `dir + sep`. The static
  handler uses it.
- **F5** — `data/` added to `.gitignore`; `git check-ignore
  data/weekly-budget.db` now exits 0. Nothing under `data/` was ever
  tracked.
- **F6** — after a 413 the socket is destroyed once the response has
  flushed (`res.once("finish", () => req.socket.destroy())`), so a
  client cannot hold the connection by trickling a large body. The
  413 itself is still delivered first.
- **F7** — `USER node` in the runtime stage of `Dockerfile`, with a
  comment: the volume at `/data` must be writable by that user on
  first deploy (chown it once).
- **F8** — `.env` added to `.dockerignore`.
- **Health** — `GET /livez` → `200 {data: {status: "alive"}}`
  (process only, never touches the DB); `GET /readyz` → `200 {data:
  {status: "ready", checks: {db: true}}}` or `503 {error: {code:
  "NOT_READY", message}}` when the database does not answer a cheap
  `SELECT 1`. Both routes sit before the static handler, which would
  otherwise swallow them as file requests. `fly.toml`'s health check
  now probes `/readyz` instead of `/`.
- **Startup** — the server now creates the database file's own parent
  directory (`ensureDbDir(dbPath)`) instead of a hardcoded `data/`,
  so `DB_PATH=/data/weekly-budget.db` on Fly.io works even when that
  directory does not exist yet.
- **Contract** — `docs/contract.md` documents `/livez`, `/readyz`,
  the security headers, the generic 500, and the finite-amount rule.

## 3. Tests and gates (all green)

- `npm run build` — exit 0
- `npm run lint` — exit 0
- `npm run typecheck` — exit 0
- `npm test` — **53/53 pass, 0 fail** (was 40/40). 13 new tests, 10
  of them red-first (they failed before the fix, 41 pass / 10 fail):
  non-finite amount/budget at the DB layer (2) and over the API with
  a raw `1e999` body (2); the generic 500 on a closed database;
  security headers on `/` and on an API response; `/livez` 200;
  `/readyz` 200 and 503 on a closed database; the socket closing
  after a 413. The 422-message test passed before the fix and pins
  the existing message. The two helper tests (`isPathWithinDir`
  sibling rejection, `ensureDbDir` creating a parent) were written
  with the fix; their red evidence is the probes in §1 (the
  `startsWith` probe and the old `mkdirSync("data")` startup code at
  HEAD), not a failing run.
- One test defect found while fixing: the socket-close test first
  failed on the fixed code too, because a socket with no `data`
  listener stays paused and defers `close` until its buffered data
  is consumed. The fix is real (proven by a raw-socket probe: 413,
  then close); the test now drains the response before asserting
  the close. This was a test bug, not an app bug, and the test was
  not weakened — it still asserts the close.

Live smoke test (built server, `DB_PATH=/tmp/wb-smoke/sub/db.sqlite`
whose parent did not exist): the directory was created and the server
started; `/livez` → `{"data":{"status":"alive"}}`; `/readyz` →
`{"data":{"status":"ready","checks":{"db":true}}}`; all four security
headers present on `/`; POST spending → 201 and the summary reads
back correctly; POST with `1e999` → 422 `VALIDATION_ERROR`.

## 4. Deferred: F9 (rate limiting)

Not implemented in this stage, deliberately. There is no public
deployment to protect: the server runs on localhost, and the Fly.io
deploy decision is still open. A rate limiter (or a token gate) on a
local-only server guards nothing, and a token gate would change the
API contract. This is a **pre-deploy gate, recorded here**: before
any public URL exists, add a per-IP rate limit on the POST endpoints
and/or a token gate, and re-run the security review against the
deployed setup. The no-auth design itself is unchanged and documented
(single-user v1, confirmed by the user 2026-11-06).

## 5. Not run (recorded, not claimed as passed)

- `npm audit` — the endpoint is blocked in this VM (403
  `policy_denied`), same as in Stage 30. The lockfile exists, is
  committed (lockfileVersion 3), and the app has zero runtime
  dependencies (7 devDependencies only, pinned by the lockfile).
- Gitleaks, OSV-Scanner, Semgrep/CodeQL — not installed in this VM.
  The skill's own secrets pattern scan ran over the whole tree
  (excluding `node_modules`, `dist`): zero matches. `.env` is not
  tracked, is gitignored, and does not exist on disk; only
  `.env.example` is tracked, with the unusable placeholder
  `API_KEY=YOUR_KEY_HERE`.

## 6. What changed, and what did not

- Changed: `src/db.ts` (ValidationError, finite checks),
  `src/server.ts` (headers, generic 500, health probes, confinement
  helper, stream destroy, `ensureDbDir`), `tests/db.test.ts`,
  `tests/server.test.ts`, `.gitignore`, `.dockerignore`,
  `Dockerfile`, `fly.toml`, `docs/contract.md`, this report.
- The Fly.io deploy files are still untracked drafts; nothing is
  deployed. The app still has no auth by documented v1 decision;
  every endpoint is intentionally public under that decision.
- Stage 40 is closed on this evidence. What remains for the dogfood:
  Stages 50 (debug/refactor) and 60 (finalize/post-publish).
