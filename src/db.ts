// SQLite storage for weekly-budget. Uses the built-in node:sqlite
// (DatabaseSync). The database file is the data: back it up by copying it.
import { DatabaseSync } from "node:sqlite";
import { isValidWeek } from "./week.js";

export interface SpendingRow {
  id: number;
  amount: number;
  category: string;
  week: string;
  spent_at: string;
}

export interface WeekRow {
  week: string;
  total: number;
  budget: number | null;
}

export type Db = DatabaseSync;

// A validation failure: bad input, never an internal error. The server
// answers these with 422 and the message itself; anything else is a 500
// with a generic message, so no internal error text ever reaches a client.
export class ValidationError extends Error {}

export function openDb(path: string): Db {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS spending (
      id INTEGER PRIMARY KEY,
      amount REAL NOT NULL CHECK (amount > 0),
      category TEXT NOT NULL CHECK (length(trim(category)) > 0),
      week TEXT NOT NULL,
      spent_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS budgets (
      week TEXT PRIMARY KEY,
      amount REAL NOT NULL CHECK (amount > 0)
    );
  `);
  return db;
}

export function addSpending(
  db: Db,
  input: { amount: number; category: string; week: string },
): SpendingRow {
  if (typeof input.amount !== "number" || !Number.isFinite(input.amount) || input.amount <= 0) {
    throw new ValidationError("amount must be greater than 0");
  }
  if (typeof input.category !== "string" || input.category.trim() === "") {
    throw new ValidationError("category must not be empty");
  }
  if (!isValidWeek(input.week)) {
    throw new ValidationError("week must be an ISO week (YYYY-Www)");
  }
  const spentAt = new Date().toISOString();
  const result = db
    .prepare(
      "INSERT INTO spending (amount, category, week, spent_at) VALUES (?, ?, ?, ?)",
    )
    .run(input.amount, input.category.trim(), input.week, spentAt);
  return {
    id: Number(result.lastInsertRowid),
    amount: input.amount,
    category: input.category.trim(),
    week: input.week,
    spent_at: spentAt,
  };
}

export function listSpending(db: Db, week: string): SpendingRow[] {
  return db
    .prepare("SELECT id, amount, category, week, spent_at FROM spending WHERE week = ? ORDER BY id ASC")
    .all(week) as unknown as SpendingRow[];
}

export function setBudget(db: Db, week: string, amount: number): void {
  if (!isValidWeek(week)) {
    throw new ValidationError("week must be an ISO week (YYYY-Www)");
  }
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
    throw new ValidationError("budget must be greater than 0");
  }
  db.prepare(
    "INSERT INTO budgets (week, amount) VALUES (?, ?) ON CONFLICT(week) DO UPDATE SET amount = excluded.amount",
  ).run(week, amount);
}

export function getBudget(db: Db, week: string): number | null {
  const row = db
    .prepare("SELECT amount FROM budgets WHERE week = ?")
    .get(week) as unknown as { amount: number } | undefined;
  return row ? row.amount : null;
}

export function listWeeks(db: Db): WeekRow[] {
  const rows = db
    .prepare("SELECT week, SUM(amount) AS total FROM spending GROUP BY week ORDER BY week DESC")
    .all() as unknown as { week: string; total: number }[];
  return rows.map((row) => ({
    week: row.week,
    total: row.total,
    budget: getBudget(db, row.week),
  }));
}
