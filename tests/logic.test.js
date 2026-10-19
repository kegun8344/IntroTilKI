// Unit tests for js/logic.js. Run with:  node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../js/logic.js");
const MOVIES = require("../js/movies.js");

const deck = [
  { id: 1, title: "Alpha", year: 2000, runtime: 90, genres: ["Comedy"] },
  { id: 2, title: "Bravo", year: 2001, runtime: 120, genres: ["Horror"] },
  { id: 3, title: "Charlie", year: 2002, runtime: 150, genres: ["Drama", "Comedy"] },
  { id: 4, title: "Delta", year: 2003, runtime: 100, genres: ["Sci-Fi"], norwegian: true }
];

test("catalogue: every movie has the fields the app needs and unique ids", () => {
  const ids = new Set();
  for (const m of MOVIES) {
    assert.ok(m.title && m.pitch, `movie ${m.id} missing title/pitch`);
    assert.ok(Number.isInteger(m.year) && m.year > 1900, `bad year on ${m.title}`);
    assert.ok(m.runtime > 60 && m.runtime < 240, `bad runtime on ${m.title}`);
    assert.ok(m.genres.length > 0, `no genres on ${m.title}`);
    assert.ok(!ids.has(m.id), `duplicate id ${m.id}`);
    ids.add(m.id);
  }
  assert.ok(MOVIES.length >= 60);
});

test("shuffle keeps the same items and does not change the input", () => {
  const input = [1, 2, 3, 4, 5, 6, 7, 8];
  const out = L.shuffle(input, L.makeRng(42));
  assert.deepEqual(input, [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual([...out].sort(), [...input].sort());
});

test("same seed gives the same shuffle", () => {
  const a = L.shuffle(MOVIES, L.makeRng(7)).map(m => m.id);
  const b = L.shuffle(MOVIES, L.makeRng(7)).map(m => m.id);
  assert.deepEqual(a, b);
});

test("filter: no genres selected means every genre", () => {
  assert.equal(L.filterMovies(deck, {}).length, 4);
});

test("filter: genre match is ANY, plus runtime and Norwegian limits", () => {
  assert.deepEqual(L.filterMovies(deck, { genres: ["Comedy"] }).map(m => m.id), [1, 3]);
  assert.deepEqual(L.filterMovies(deck, { genres: ["Comedy"], maxRuntime: 120 }).map(m => m.id), [1]);
  assert.deepEqual(L.filterMovies(deck, { norwegianOnly: true }).map(m => m.id), [4]);
});

test("buildDeck never returns more than the pool or the requested size", () => {
  assert.equal(L.buildDeck(MOVIES, {}, 20, L.makeRng(1)).length, 20);
  assert.equal(L.buildDeck(deck, { genres: ["Horror"] }, 20, L.makeRng(1)).length, 1);
});

test("computeResults: both yes = match, one yes = maybe, sorted by score", () => {
  const a = { 1: "yes", 2: "super", 3: "no", 4: "super" };
  const b = { 1: "yes", 2: "super", 3: "yes", 4: "no" };
  const r = L.computeResults(deck, a, b);
  assert.deepEqual(r.matches.map(m => m.movie.id), [2, 1]);
  assert.equal(r.matches[0].perfect, true);
  assert.equal(r.matches[0].score, 4);
  assert.deepEqual(r.maybes.map(m => [m.movie.id, m.likedBy]), [[4, "a"], [3, "b"]]);
});

test("computeResults: missing votes count as no", () => {
  const r = L.computeResults(deck, { 1: "yes" }, {});
  assert.equal(r.matches.length, 0);
  assert.equal(r.maybes.length, 1);
});

test("pickWinner returns null with no matches and always a match otherwise", () => {
  assert.equal(L.pickWinner([], L.makeRng(1)), null);
  const r = L.computeResults(deck, { 1: "yes", 2: "yes" }, { 1: "yes", 2: "yes" });
  for (let s = 0; s < 50; s++) {
    assert.ok(r.matches.includes(L.pickWinner(r.matches, L.makeRng(s))));
  }
});

test("pickWinner favours higher scores (weighted draw)", () => {
  const r = L.computeResults(deck, { 1: "super", 2: "yes" }, { 1: "super", 2: "yes" });
  const rng = L.makeRng(123);
  let wins = 0;
  for (let i = 0; i < 3000; i++) if (L.pickWinner(r.matches, rng).movie.id === 1) wins++;
  // Expected share is 4/6 = 0.67
  assert.ok(wins / 3000 > 0.6 && wins / 3000 < 0.73, `share was ${wins / 3000}`);
});

test("resultsToText mentions the winner and the matches", () => {
  const r = L.computeResults(deck, { 1: "yes" }, { 1: "super" });
  const txt = L.resultsToText(["Kim", "Sam"], r, r.matches[0]);
  assert.match(txt, /Kim \+ Sam/);
  assert.match(txt, /Tonight we watch: Alpha \(2000\)/);
});
