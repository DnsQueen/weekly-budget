import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { openDb, addSpending, listSpending, setBudget, getBudget, listWeeks } from "../src/db.js";

describe("db", () => {
  it("stores and lists spending for a week", () => {
    const db = openDb(":memory:");
    const one = addSpending(db, { amount: 20, category: "food", week: "2026-W45" });
    const two = addSpending(db, { amount: 30, category: "food", week: "2026-W45" });
    addSpending(db, { amount: 30, category: "transport", week: "2026-W45" });
    const rows = listSpending(db, "2026-W45");
    assert.equal(rows.length, 3);
    assert.equal(rows[0].id, one.id);
    assert.equal(rows[1].id, two.id);
    assert.equal(rows[0].amount, 20);
    assert.equal(rows[0].category, "food");
    assert.equal(rows[0].week, "2026-W45");
    assert.equal(typeof rows[0].spent_at, "string");
    db.close();
  });

  it("rejects a non-positive amount", () => {
    const db = openDb(":memory:");
    assert.throws(
      () => addSpending(db, { amount: 0, category: "food", week: "2026-W45" }),
      /amount must be greater than 0/,
    );
    assert.throws(
      () => addSpending(db, { amount: -5, category: "food", week: "2026-W45" }),
      /amount must be greater than 0/,
    );
    db.close();
  });

  it("rejects an empty category and a bad week", () => {
    const db = openDb(":memory:");
    assert.throws(
      () => addSpending(db, { amount: 10, category: "  ", week: "2026-W45" }),
      /category must not be empty/,
    );
    assert.throws(
      () => addSpending(db, { amount: 10, category: "food", week: "2026-45" }),
      /week must be an ISO week/,
    );
    db.close();
  });

  it("stores one budget per week and returns it", () => {
    const db = openDb(":memory:");
    assert.equal(getBudget(db, "2026-W45"), null);
    setBudget(db, "2026-W45", 100);
    assert.equal(getBudget(db, "2026-W45"), 100);
    setBudget(db, "2026-W45", 150);
    assert.equal(getBudget(db, "2026-W45"), 150);
    assert.throws(() => setBudget(db, "2026-W45", 0), /budget must be greater than 0/);
    db.close();
  });

  it("lists weeks with totals, newest first", () => {
    const db = openDb(":memory:");
    addSpending(db, { amount: 20, category: "food", week: "2026-W44" });
    addSpending(db, { amount: 30, category: "food", week: "2026-W45" });
    addSpending(db, { amount: 30, category: "transport", week: "2026-W45" });
    setBudget(db, "2026-W45", 100);
    const weeks = listWeeks(db);
    assert.equal(weeks.length, 2);
    assert.equal(weeks[0].week, "2026-W45");
    assert.equal(weeks[0].total, 60);
    assert.equal(weeks[0].budget, 100);
    assert.equal(weeks[1].week, "2026-W44");
    assert.equal(weeks[1].total, 20);
    assert.equal(weeks[1].budget, null);
    db.close();
  });

  it("rejects a non-finite amount", () => {
    const db = openDb(":memory:");
    assert.throws(
      () => addSpending(db, { amount: Number.POSITIVE_INFINITY, category: "food", week: "2026-W45" }),
      /amount must be greater than 0/,
    );
    db.close();
  });

  it("rejects a non-finite budget", () => {
    const db = openDb(":memory:");
    assert.throws(() => setBudget(db, "2026-W45", Number.POSITIVE_INFINITY), /budget must be greater than 0/);
    db.close();
  });

  it("enforces amount > 0 at the database level", () => {
    const db = openDb(":memory:");
    assert.throws(
      () => db.exec("INSERT INTO spending (amount, category, week, spent_at) VALUES (0, 'food', '2026-W45', '2026-11-06T00:00:00.000Z')"),
      /CHECK constraint failed/,
    );
    db.close();
  });
});
