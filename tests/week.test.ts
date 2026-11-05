import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isoWeek, isValidWeek } from "../src/week.js";

describe("isoWeek", () => {
  it("returns the ISO week for a known Friday", () => {
    assert.equal(isoWeek(new Date("2026-11-06T12:00:00")), "2026-W45");
  });

  it("returns week 01 for the first Thursday of the year", () => {
    assert.equal(isoWeek(new Date("2026-01-01T12:00:00")), "2026-W01");
  });

  it("returns week 02 for the following Monday", () => {
    assert.equal(isoWeek(new Date("2026-01-05T12:00:00")), "2026-W02");
  });

  it("pads single-digit weeks", () => {
    assert.equal(isoWeek(new Date("2026-01-01T12:00:00")).slice(-2), "01");
  });
});

describe("isValidWeek", () => {
  it("accepts a well-formed ISO week", () => {
    assert.equal(isValidWeek("2026-W45"), true);
  });

  it("rejects a missing W", () => {
    assert.equal(isValidWeek("2026-45"), false);
  });

  it("rejects week 00 and week 54", () => {
    assert.equal(isValidWeek("2026-W00"), false);
    assert.equal(isValidWeek("2026-W54"), false);
  });

  it("rejects a non-string", () => {
    assert.equal(isValidWeek(45 as unknown as string), false);
  });
});
