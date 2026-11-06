// HTTP server for weekly-budget. Plain node:http, no framework.
// One envelope: success is {data}, errors are {error: {code, message}}.
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mkdirSync } from "node:fs";
import { openDb, addSpending, listSpending, setBudget, listWeeks, type Db } from "./db.js";
import { weeklySummary } from "./summary.js";
import { isoWeek, isValidWeek } from "./week.js";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function sendError(res: ServerResponse, status: number, code: string, message: string): void {
  sendJson(res, status, { error: { code, message } });
}

// Maps a readJson failure to its response: an oversized body is 413,
// anything else that is not JSON is 400.
function sendReadError(res: ServerResponse, error: unknown): void {
  if ((error as Error).message === "BODY_TOO_LARGE") {
    sendError(res, 413, "BODY_TOO_LARGE", "request body exceeds 1 MB");
  } else {
    sendError(res, 400, "BAD_JSON", "request body is not valid JSON");
  }
}

// Max request body: 1 MB. A client must not be able to make the server
// buffer an unbounded body in memory before parsing it.
const MAX_BODY_BYTES = 1_048_576;

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolvePromise, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;
    req.on("data", (chunk: Buffer) => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        tooLarge = true;
        reject(new Error("BODY_TOO_LARGE"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (tooLarge) return;
      try {
        resolvePromise(JSON.parse(Buffer.concat(chunks).toString("utf-8")));
      } catch {
        reject(new Error("BAD_JSON"));
      }
    });
    req.on("error", reject);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createServer(db: Db, opts: { publicDir: string }): Server {
  const publicDir = resolve(opts.publicDir);

  return createHttpServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const path = url.pathname;

      // Static frontend.
      if (req.method === "GET" && (path === "/" || !path.startsWith("/api/"))) {
        const file = path === "/" ? "index.html" : path.slice(1);
        const resolved = resolve(join(publicDir, file));
        if (!resolved.startsWith(publicDir)) {
          sendError(res, 404, "NOT_FOUND", "not found");
          return;
        }
        try {
          const body = await readFile(resolved);
          res.writeHead(200, { "content-type": CONTENT_TYPES[extname(resolved)] ?? "application/octet-stream" });
          res.end(body);
        } catch {
          sendError(res, 404, "NOT_FOUND", "not found");
        }
        return;
      }

      // POST /api/v1/spending
      if (req.method === "POST" && path === "/api/v1/spending") {
        let body: unknown;
        try {
          body = await readJson(req);
        } catch (error) {
          sendReadError(res, error);
          return;
        }
        if (!isRecord(body)) {
          sendError(res, 422, "VALIDATION_ERROR", "body must be an object");
          return;
        }
        try {
          const row = addSpending(db, {
            amount: body["amount"] as number,
            category: body["category"] as string,
            week: body["week"] as string,
          });
          sendJson(res, 201, { data: row });
        } catch (error) {
          sendError(res, 422, "VALIDATION_ERROR", (error as Error).message);
        }
        return;
      }

      // POST /api/v1/budgets
      if (req.method === "POST" && path === "/api/v1/budgets") {
        let body: unknown;
        try {
          body = await readJson(req);
        } catch (error) {
          sendReadError(res, error);
          return;
        }
        if (!isRecord(body)) {
          sendError(res, 422, "VALIDATION_ERROR", "body must be an object");
          return;
        }
        try {
          setBudget(db, body["week"] as string, body["amount"] as number);
          sendJson(res, 201, { data: { week: body["week"], amount: body["amount"] } });
        } catch (error) {
          sendError(res, 422, "VALIDATION_ERROR", (error as Error).message);
        }
        return;
      }

      // GET /api/v1/weekly-summary
      if (req.method === "GET" && path === "/api/v1/weekly-summary") {
        const week = url.searchParams.get("week") ?? isoWeek(new Date());
        const budgetRaw = url.searchParams.get("budget");
        const category = url.searchParams.get("category") ?? undefined;
        const budget = budgetRaw === null ? NaN : Number(budgetRaw);
        if (!isValidWeek(week)) {
          sendError(res, 422, "VALIDATION_ERROR", "week must be an ISO week (YYYY-Www)");
          return;
        }
        if (!Number.isFinite(budget) || budget <= 0) {
          sendError(res, 422, "VALIDATION_ERROR", "budget must be greater than 0");
          return;
        }
        const rows = listSpending(db, week);
        const amounts = rows
          .filter((row) => category === undefined || row.category === category)
          .map((row) => row.amount);
        sendJson(res, 200, { data: weeklySummary(amounts, budget) });
        return;
      }

      // GET /api/v1/spending
      if (req.method === "GET" && path === "/api/v1/spending") {
        const week = url.searchParams.get("week") ?? isoWeek(new Date());
        if (!isValidWeek(week)) {
          sendError(res, 422, "VALIDATION_ERROR", "week must be an ISO week (YYYY-Www)");
          return;
        }
        const page = Math.max(1, Number(url.searchParams.get("page") ?? "1") || 1);
        const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("pageSize") ?? "20") || 20));
        const rows = listSpending(db, week);
        const totalItems = rows.length;
        const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
        const data = rows.slice((page - 1) * pageSize, page * pageSize);
        sendJson(res, 200, { data, pagination: { page, pageSize, totalItems, totalPages } });
        return;
      }

      // GET /api/v1/weeks
      if (req.method === "GET" && path === "/api/v1/weeks") {
        sendJson(res, 200, { data: listWeeks(db) });
        return;
      }

      sendError(res, 404, "NOT_FOUND", "not found");
    } catch (error) {
      sendError(res, 500, "INTERNAL_ERROR", (error as Error).message);
    }
  });
}

// Run as a standalone server: `node dist/src/server.js`.
const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const port = Number(process.env["PORT"] ?? "3000");
  const dbPath = process.env["DB_PATH"] ?? "data/weekly-budget.db";
  mkdirSync("data", { recursive: true });
  const db = openDb(dbPath);
  const publicDir = process.env["PUBLIC_DIR"] ?? join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "public");
  const server = createServer(db, { publicDir });
  server.listen(port, () => {
    console.log(`weekly-budget listening on http://localhost:${port}`);
  });
}
