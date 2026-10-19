// Tests for the catalogue build tool (tools/build-movies.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parse } from "../tools/build-movies.mjs";

const good = "Alpha|1999|100|Comedy|US|Some Director|A;B|A fine pitch for a movie.";

test("the real data/movies.txt has no errors", () => {
  const { movies, errors } = parse(fs.readFileSync(new URL("../data/movies.txt", import.meta.url), "utf8"));
  assert.deepEqual(errors, []);
  assert.ok(movies.length >= 500);
});

test("a valid line is parsed into a movie with a stable id", () => {
  const a = parse(good).movies[0], b = parse("# comment\n\n" + good).movies[0];
  assert.equal(a.title, "Alpha");
  assert.deepEqual(a.cast, ["A", "B"]);
  assert.equal(a.id, b.id);
});

test("bad lines are reported with line numbers", () => {
  const bad = [
    good,
    "Too|few|fields",
    "Beta|1850|100|Comedy|US|D|A|Year is way too early.",
    "Gamma|2000|20|Comedy|US|D|A|Runtime is way too short.",
    "Delta|2000|100|Cooking|US|D|A|Unknown genre here.",
    "Echo|2000|100|Comedy|XX|D|A|Unknown country here.",
    "Fox|2000|100|Comedy|US|D|A|no full stop",
    good
  ].join("\n");
  const { errors } = parse(bad);
  const has = (line, text) => assert.ok(errors.some(e => e.startsWith(`line ${line}:`) && e.includes(text)), `line ${line}: ${text}`);
  has(2, "expected 8 fields");
  has(3, "bad year");
  has(4, "bad runtime");
  has(5, "unknown genre");
  has(6, "unknown country");
  has(7, "should end with");
  has(8, "duplicate of line 1");
});
