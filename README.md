# weekly-budget

Weekly spending tracker: add spending, see the weekly summary with an 80%
warning, browse categories, and look back over several weeks. Persian +
English, deployed for real use.

Built 0–100 with [ORCINUS](https://github.com/DnsQueen/orcinus-skills) —
one integrated nervous system, from raw idea to release. The idea was
calibrated with the real user (2026-11-06): v1 is add spending + weekly
summary, categories, multi-week history, both languages, deployed.

## Stack

TypeScript 6, Node 24, SQLite (`node:sqlite`, built in), no framework
(plain `node:http`), static frontend, no production dependencies.
See `docs/adr/0001-stack-typescript-node-sqlite.md` and
`docs/contract.md`.

## Run

```bash
npm install
npm run build
npm start
```

Then open http://localhost:3000 (default port 3000, `PORT` overrides it).

## Checks

```bash
npm run build      # tsc
npm run lint       # eslint
npm run typecheck  # tsc --noEmit
npm test           # tsc && node --test dist/tests/*.test.js
```

## Data

Spending lives in `data/weekly-budget.db` (SQLite, WAL mode). It is never
committed to git. Back up by copying the file.
