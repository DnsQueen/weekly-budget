import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { connect } from "node:net";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, type Db } from "../src/db.js";
import { createServer, ensureDbDir, isPathWithinDir } from "../src/server.js";

let server: Server;
let base: string;

// Every test gets its own fresh in-memory DB and its own server, so no
// test depends on the data another test added (order-independent).
beforeEach(async () => {
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

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function post(path: string, body: unknown, raw?: string) {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: raw ?? JSON.stringify(body),
  });
}

// A second server on its own port, for tests that need a database in a
// particular state (for example closed) instead of the fresh one above.
async function startTestServer(db: Db): Promise<{ base: string; close: () => Promise<void> }> {
  const srv = createServer(db, { publicDir: new URL("../../public/", import.meta.url).pathname });
  await new Promise<void>((resolve) => {
    srv.listen(0, "127.0.0.1", () => resolve());
  });
  const address = srv.address();
  if (typeof address !== "object" || address === null) throw new Error("no address");
  return {
    base: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve) => srv.close(() => resolve())),
  };
}

// The canonical week used by the tests below: 20 food + 30 food + 30
// transport = 80 total, budget 100 -> {80, 20, true, 80}.
async function seedWeek() {
  await post("/api/v1/spending", { amount: 20, category: "food", week: "2026-W45" });
  await post("/api/v1/spending", { amount: 30, category: "food", week: "2026-W45" });
  await post("/api/v1/spending", { amount: 30, category: "transport", week: "2026-W45" });
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

  it("rejects a week that does not exist with 422", async () => {
    // 2025 has 52 ISO weeks, so 2025-W53 is not a real week.
    const res = await post("/api/v1/spending", { amount: 20, category: "food", week: "2025-W53" });
    assert.equal(res.status, 422);
    const json = await res.json() as { error: { code: string } };
    assert.equal(json.error.code, "VALIDATION_ERROR");
  });

  it("rejects malformed JSON with 400 BAD_JSON", async () => {
    const res = await post("/api/v1/spending", undefined, "{not json");
    assert.equal(res.status, 400);
    const json = await res.json() as { error: { code: string } };
    assert.equal(json.error.code, "BAD_JSON");
  });

  it("rejects an oversized body with 413 BODY_TOO_LARGE", async () => {
    const big = "x".repeat(1_048_577);
    const res = await post("/api/v1/spending", undefined, `{"amount":20,"category":"${big}","week":"2026-W45"}`);
    assert.equal(res.status, 413);
    const json = await res.json() as { error: { code: string } };
    assert.equal(json.error.code, "BODY_TOO_LARGE");
  });

  it("returns the weekly summary with exact values", async () => {
    await seedWeek();
    const res = await fetch(`${base}/api/v1/weekly-summary?week=2026-W45&budget=100`);
    assert.equal(res.status, 200);
    const json = await res.json() as { data: { total: number; remaining: number; warned: boolean; percent: number } };
    assert.deepEqual(json.data, { total: 80, remaining: 20, warned: true, percent: 80 });
  });

  it("filters the summary by category", async () => {
    await seedWeek();
    const res = await fetch(`${base}/api/v1/weekly-summary?week=2026-W45&budget=100&category=food`);
    assert.equal(res.status, 200);
    const json = await res.json() as { data: { total: number; remaining: number; warned: boolean; percent: number } };
    assert.deepEqual(json.data, { total: 50, remaining: 50, warned: false, percent: 50 });
  });

  it("rejects a missing budget with 422", async () => {
    const res = await fetch(`${base}/api/v1/weekly-summary?week=2026-W45`);
    assert.equal(res.status, 422);
  });

  it("rejects a zero budget with 422", async () => {
    const res = await fetch(`${base}/api/v1/weekly-summary?week=2026-W45&budget=0`);
    assert.equal(res.status, 422);
    const json = await res.json() as { error: { code: string } };
    assert.equal(json.error.code, "VALIDATION_ERROR");
  });

  it("lists spending with pagination", async () => {
    await seedWeek();
    const res = await fetch(`${base}/api/v1/spending?week=2026-W45`);
    assert.equal(res.status, 200);
    const json = await res.json() as {
      data: { amount: number }[];
      pagination: { page: number; pageSize: number; totalItems: number; totalPages: number };
    };
    assert.equal(json.data.length, 3);
    assert.deepEqual(json.pagination, { page: 1, pageSize: 20, totalItems: 3, totalPages: 1 });
  });

  it("returns page 2 of spending (the offset, not page 1 again)", async () => {
    await seedWeek();
    const res = await fetch(`${base}/api/v1/spending?week=2026-W45&page=2&pageSize=2`);
    assert.equal(res.status, 200);
    const json = await res.json() as {
      data: { amount: number; category: string }[];
      pagination: { page: number; pageSize: number; totalItems: number; totalPages: number };
    };
    // 3 items, pageSize 2: page 2 holds only the third (transport, 30).
    assert.equal(json.data.length, 1);
    assert.equal(json.data[0].amount, 30);
    assert.equal(json.data[0].category, "transport");
    assert.deepEqual(json.pagination, { page: 2, pageSize: 2, totalItems: 3, totalPages: 2 });
  });

  it("rejects a zero budget with 422", async () => {
    const res = await post("/api/v1/budgets", { week: "2026-W45", amount: 0 });
    assert.equal(res.status, 422);
    const json = await res.json() as { error: { code: string } };
    assert.equal(json.error.code, "VALIDATION_ERROR");
  });

  it("accepts a body of exactly the size limit (1 MB)", async () => {
    // The limit is `size > MAX_BODY_BYTES` (strictly greater), so a body
    // of exactly 1,048,576 bytes must be accepted, not rejected with 413.
    const fixed = `{"amount":10,"category":"","week":"2026-W45"}`;
    const padLength = 1_048_576 - fixed.length;
    const raw = `{"amount":10,"category":"${"x".repeat(padLength)}","week":"2026-W45"}`;
    assert.equal(Buffer.byteLength(raw), 1_048_576);
    const res = await post("/api/v1/spending", undefined, raw);
    assert.equal(res.status, 201);
  });

  it("stores a budget and lists weeks with it", async () => {
    await seedWeek();
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

  it("rejects an infinite amount with 422 (JSON 1e999 parses to Infinity)", async () => {
    // JSON.stringify(Infinity) is `null`, so the raw body is required:
    // `1e999` is valid JSON that parses to Infinity.
    const res = await post("/api/v1/spending", undefined, `{"amount":1e999,"category":"food","week":"2026-W45"}`);
    assert.equal(res.status, 422);
    const json = await res.json() as { error: { code: string } };
    assert.equal(json.error.code, "VALIDATION_ERROR");
  });

  it("rejects an infinite budget with 422", async () => {
    const res = await post("/api/v1/budgets", undefined, `{"week":"2026-W45","amount":1e999}`);
    assert.equal(res.status, 422);
    const json = await res.json() as { error: { code: string } };
    assert.equal(json.error.code, "VALIDATION_ERROR");
  });

  it("returns a generic 500 without internal details when the database fails", async () => {
    const db = openDb(":memory:");
    const second = await startTestServer(db);
    try {
      db.close();
      const res = await fetch(`${second.base}/api/v1/weeks`);
      assert.equal(res.status, 500);
      const json = await res.json() as { error: { code: string; message: string } };
      assert.equal(json.error.code, "INTERNAL_ERROR");
      assert.equal(json.error.message, "internal error");
    } finally {
      await second.close();
    }
  });

  it("keeps the 422 message to the validation message itself", async () => {
    const res = await post("/api/v1/spending", { amount: 0, category: "food", week: "2026-W45" });
    assert.equal(res.status, 422);
    const json = await res.json() as { error: { code: string; message: string } };
    assert.equal(json.error.code, "VALIDATION_ERROR");
    assert.equal(json.error.message, "amount must be greater than 0");
  });

  it("sends security headers on the frontend page and on API responses", async () => {
    for (const path of ["/", "/api/v1/weeks"]) {
      const res = await fetch(`${base}${path}`);
      assert.equal(res.headers.get("x-content-type-options"), "nosniff");
      assert.equal(res.headers.get("x-frame-options"), "DENY");
      assert.equal(res.headers.get("referrer-policy"), "no-referrer");
      assert.match(res.headers.get("content-security-policy") ?? "", /default-src 'self'/);
    }
  });

  it("answers liveness without touching the database", async () => {
    const res = await fetch(`${base}/livez`);
    assert.equal(res.status, 200);
    const json = await res.json() as { data: { status: string } };
    assert.deepEqual(json.data, { status: "alive" });
  });

  it("answers readiness with the database check", async () => {
    const res = await fetch(`${base}/readyz`);
    assert.equal(res.status, 200);
    const json = await res.json() as { data: { status: string; checks: { db: boolean } } };
    assert.deepEqual(json.data, { status: "ready", checks: { db: true } });
  });

  it("answers readiness with 503 when the database is down", async () => {
    const db = openDb(":memory:");
    const second = await startTestServer(db);
    try {
      db.close();
      const res = await fetch(`${second.base}/readyz`);
      assert.equal(res.status, 503);
      const json = await res.json() as { error: { code: string } };
      assert.equal(json.error.code, "NOT_READY");
    } finally {
      await second.close();
    }
  });

  it("closes the connection after rejecting an oversized body", async () => {
    // No `Connection: close` header: with keep-alive the socket must be
    // closed by the server itself (req.destroy), not by the client.
    const port = Number(new URL(base).port);
    await new Promise<void>((resolve, reject) => {
      const socket = connect(port, "127.0.0.1", () => {
        socket.write(
          "POST /api/v1/spending HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\n" +
            `Content-Length: ${1_048_577}\r\n\r\n` +
            "x".repeat(1_048_577),
        );
      });
      // Drain the 413 response: a paused socket defers 'end'/'close'
      // until its buffered data is consumed, so without this the close
      // below would never be observed even though the server closed it.
      socket.on("data", () => {});
      socket.on("close", () => resolve());
      socket.on("error", () => resolve());
      setTimeout(() => reject(new Error("socket was not closed after the 413")), 2000).unref();
    });
  });
});

describe("path confinement", () => {
  it("rejects a sibling directory that shares the prefix", () => {
    // The old check was a bare startsWith: "/app/public-evil/x" starts
    // with "/app/public" and passed it. The helper must not.
    assert.equal(isPathWithinDir("/app/public", "/app/public-evil/x"), false);
    assert.equal(isPathWithinDir("/app/public", "/app/public"), true);
    assert.equal(isPathWithinDir("/app/public", "/app/public/index.html"), true);
  });
});

describe("ensureDbDir", () => {
  it("creates the database parent directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "wb-db-"));
    try {
      const dbPath = join(dir, "sub", "weekly-budget.db");
      ensureDbDir(dbPath);
      assert.equal(existsSync(join(dir, "sub")), true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
