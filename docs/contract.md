# Contract — weekly-budget v1

The API and domain contract for the weekly-budget app. Versioned under
`/api/v1`. One envelope: success is `{data}`, errors are `{error: {code,
message}}`. All money is a plain number (no currency handling in v1);
all weeks are ISO week strings (`YYYY-Www`, e.g. `2026-W45`).

## Domain (pure, no I/O)

These functions are the same domain the demo proves (7/7 tests), extended
with categories:

- `budgetWarning(spent, budget)`: `true` when `spent >= budget * 0.8`.
  Throws `Error("budget must be greater than 0")` when `budget <= 0`.
- `weeklySummary(spending, budget)`: `{total, remaining, warned, percent}`
  — `percent` is rounded; `warned` is the 80% rule; `budget <= 0` throws
  the same error.
- `spending` entries carry a `category` (free text in v1, e.g. `food`,
  `transport`) and a `week` (ISO week string). The weekly summary can be
  filtered by category.

## Storage (SQLite)

- `spending(id INTEGER PRIMARY KEY, amount REAL NOT NULL, category TEXT
  NOT NULL, week TEXT NOT NULL, spent_at TEXT NOT NULL)` — one row per
  spending entry. `amount > 0` enforced by a CHECK constraint.
- `budgets(week TEXT PRIMARY KEY, amount REAL NOT NULL)` — one row per
  week, `amount > 0` enforced by a CHECK constraint.
- The database file lives at `data/weekly-budget.db` (WAL mode). It is
  never committed to git.

## HTTP API (`/api/v1`)

| Method | Route | Success | Error |
| ------ | ----- | ------- | ----- |
| `POST` | `/spending` `{amount, category, week}` | `201 {data: {id, amount, category, week, spent_at}}` | `422 {error: {code: "VALIDATION_ERROR", message}}` when amount is not a positive number, category is empty, or week is not an ISO week |
| `POST` | `/budgets` `{week, amount}` | `201 {data: {week, amount}}` | `422` when amount is not a positive number or week is not an ISO week |
| `GET` | `/weekly-summary?week=YYYY-Www&budget=100&category=` | `200 {data: {total, remaining, warned, percent}}` | `422` when budget is missing or `<= 0`, or week is not an ISO week |
| `GET` | `/spending?week=YYYY-Www` | `200 {data: [...], pagination: {page, pageSize, totalItems, totalPages}}` | `422` when week is not an ISO week |
| `GET` | `/weeks` | `200 {data: [{week, total, budget}]}` — one entry per week with spending, newest first | — |

Unknown routes return `404 {error: {code: "NOT_FOUND", message}}`.
Malformed JSON returns `400 {error: {code: "BAD_JSON", message}}`.

## Frontend (`/`)

- Static HTML/CSS/JS (`public/`), no framework, served by the same server.
- Language: `?locale=en` or `?locale=fa` (default `fa`); missing keys fall
  back to the default language, never empty, never a raw key. Persian
  renders `dir=rtl`.
- The page shows: the add-spending form (amount, category, week), the
  weekly summary (total, remaining, warned, percent), and the history of
  recent weeks.

## v1 scope (decided 2026-11-06 with the user)

- In: add spending, weekly summary with the 80% warning, categories,
  history of several weeks, Persian + English, deployed for real use.
- Out (non-goals): user accounts / multi-user, login/auth, recurring
  budgets, import/export, notifications, currency conversion.

## Versioning

- Breaking changes (renaming/removing a field, changing a rule) go in a
  new API version (`/api/v2`), never by editing `/api/v1` in place.
  Additive changes (a new optional field) are allowed in `/api/v1`.
