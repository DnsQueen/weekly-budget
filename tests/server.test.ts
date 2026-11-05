import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { openDb } from "../src/db.js";
import { createServer } from "../src/server.js";

let server: Server;
let base: string;

before(async () => {
  const db = openDb(":memory:");
  server = createServer(db, { publicDir: new URL("../../public/", import.meta.url).pathname });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address !== "object" || address === null) throw new Error("no address");
      base = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function post(path: string, body: unknown, raw?: string) {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: raw ?? JSON.stringify(body),
  });
}

describe("server", () => {
  it("creates a spending entry and returns 201 with the envelope", async () => {
    const res = await post("/api/v1/spending", { amount: 20, category: "food", week: "2026-W45" });
    assert.equal(res.status, 201);
    const json = await res.json() as { data: { id: number; amount: number; category: string; week: string; spent_at: string } };
    assert.equal(json.data.amount, 20);
    assert.equal(json.data.category, "food");
    assert.equal(json.data.week, "2026-W45");
    assert.equal(typeof json.data.id, "number");
    assert.equal(typeof json.data.spent_at, "string");
  });

  it("rejects a non-positive amount with 422 VALIDATION_ERROR", async () => {
    const res = await post("/api/v1/spending", { amount: 0, category: "food", week: "2026-W45" });
    assert.equal(res.status, 422);
    const json = await res.json() as { error: { code: string; message: string } };
    assert.equal(json.error.code, "VALIDATION_ERROR");
  });

  it("rejects malformed JSON with 400 BAD_JSON", async () => {
    const res = await post("/api/v1/spending", undefined, "{not json");
    assert.equal(res.status, 400);
    const json = await res.json() as { error: { code: string } };
    assert.equal(json.error.code, "BAD_JSON");
  });

  it("returns the weekly summary with exact values", async () => {
    await post("/api/v1/spending", { amount: 30, category: "food", week: "2026-W45" });
    await post("/api/v1/spending", { amount: 30, category: "transport", week: "2026-W45" });
    const res = await fetch(`${base}/api/v1/weekly-summary?week=2026-W45&budget=100`);
    assert.equal(res.status, 200);
    const json = await res.json() as { data: { total: number; remaining: number; warned: boolean; percent: number } };
    assert.deepEqual(json.data, { total: 80, remaining: 20, warned: true, percent: 80 });
  });

  it("filters the summary by category", async () => {
    const res = await fetch(`${base}/api/v1/weekly-summary?week=2026-W45&budget=100&category=food`);
    assert.equal(res.status, 200);
    const json = await res.json() as { data: { total: number; remaining: number; warned: boolean; percent: number } };
    assert.deepEqual(json.data, { total: 50, remaining: 50, warned: false, percent: 50 });
  });

  it("rejects a missing budget with 422", async () => {
    const res = await fetch(`${base}/api/v1/weekly-summary?week=2026-W45`);
    assert.equal(res.status, 422);
  });

  it("lists spending with pagination", async () => {
    const res = await fetch(`${base}/api/v1/spending?week=2026-W45`);
    assert.equal(res.status, 200);
    const json = await res.json() as {
      data: { amount: number }[];
      pagination: { page: number; pageSize: number; totalItems: number; totalPages: number };
    };
    assert.equal(json.data.length, 3);
    assert.deepEqual(json.pagination, { page: 1, pageSize: 20, totalItems: 3, totalPages: 1 });
  });

  it("stores a budget and lists weeks with it", async () => {
    const res = await post("/api/v1/budgets", { week: "2026-W45", amount: 100 });
    assert.equal(res.status, 201);
    const weeks = await (await fetch(`${base}/api/v1/weeks`)).json() as {
      data: { week: string; total: number; budget: number | null }[];
    };
    assert.deepEqual(weeks.data, [{ week: "2026-W45", total: 80, budget: 100 }]);
  });

  it("returns 404 NOT_FOUND for an unknown route", async () => {
    const res = await fetch(`${base}/api/v1/nope`);
    assert.equal(res.status, 404);
    const json = await res.json() as { error: { code: string } };
    assert.equal(json.error.code, "NOT_FOUND");
  });

  it("serves the frontend page", async () => {
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /weekly-budget/);
  });
});
