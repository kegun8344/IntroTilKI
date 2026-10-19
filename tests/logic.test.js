// Unit tests for js/logic.js. Run with:  npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../js/logic.js");
const MOVIES = require("../js/movies.js");

const deck = [
  { id: "a", title: "Alpha", year: 1985, runtime: 90, genres: ["Comedy"], country: "US" },
  { id: "b", title: "Bravo", year: 2001, runtime: 120, genres: ["Horror"], country: "NO" },
  { id: "c", title: "Charlie", year: 2012, runtime: 150, genres: ["Drama", "Romance"], country: "KR" },
  { id: "d", title: "Delta", year: 2020, runtime: 100, genres: ["Sci-Fi", "Mystery"], country: "SE" }
];
const ids = list => list.map(m => (m.movie || m).id);

// ---------- catalogue ----------
test("catalogue has 500+ valid movies with unique ids", () => {
  assert.ok(MOVIES.length >= 500, `only ${MOVIES.length}`);
  const seen = new Set();
  for (const m of MOVIES) {
    assert.ok(m.title && m.pitch && m.director, `incomplete: ${m.title}`);
    assert.ok(m.year >= 1920 && m.year <= 2026, `year ${m.title}`);
    assert.ok(m.runtime >= 60 && m.runtime <= 260, `runtime ${m.title}`);
    assert.ok(MOVIES.COUNTRIES[m.country], `country ${m.title}`);
    assert.ok(!seen.has(m.id), `duplicate id ${m.id}`);
    seen.add(m.id);
  }
});

test("every vibe and region finds at least 10 movies", () => {
  for (const v of L.VIBES) assert.ok(L.filterMovies(MOVIES, { vibe: v.id }).length >= 10, v.label);
  for (const r of L.REGIONS) assert.ok(L.filterMovies(MOVIES, { region: r.id }).length >= 10, r.label);
});

// ---------- random ----------
test("shuffle keeps the same items, does not change the input, and is repeatable with a seed", () => {
  const input = [1, 2, 3, 4, 5, 6, 7, 8];
  const out = L.shuffle(input, L.makeRng(42));
  assert.deepEqual(input, [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual([...out].sort(), input);
  assert.deepEqual(L.shuffle(MOVIES, L.makeRng(7)).map(m => m.id), L.shuffle(MOVIES, L.makeRng(7)).map(m => m.id));
});

// ---------- filters ----------
test("filter: genres (any), years, runtime", () => {
  assert.equal(L.filterMovies(deck, {}).length, 4);
  assert.deepEqual(ids(L.filterMovies(deck, { genres: ["Comedy", "Horror"] })), ["a", "b"]);
  assert.deepEqual(ids(L.filterMovies(deck, { fromYear: 2000, toYear: 2015 })), ["b", "c"]);
  assert.deepEqual(ids(L.filterMovies(deck, { maxRuntime: 100 })), ["a", "d"]);
});

test("filter: vibe, region and excluded (seen) movies", () => {
  assert.deepEqual(ids(L.filterMovies(deck, { vibe: "scary" })), ["b"]);
  assert.deepEqual(ids(L.filterMovies(deck, { vibe: "date" })), ["c"]);
  assert.deepEqual(ids(L.filterMovies(deck, { region: "nordic" })), ["b", "d"]);
  assert.deepEqual(ids(L.filterMovies(deck, { region: "world" })), ["b", "c", "d"]);
  assert.deepEqual(ids(L.filterMovies(deck, { exclude: { a: true, c: true } })), ["b", "d"]);
});

test("buildDeck never returns more than the pool or the requested size", () => {
  assert.equal(L.buildDeck(MOVIES, {}, 30, L.makeRng(1)).length, 30);
  assert.equal(L.buildDeck(deck, { genres: ["Horror"] }, 20, L.makeRng(1)).length, 1);
});

// ---------- answers ----------
test("superLeft counts down must-watch answers and never goes below zero", () => {
  assert.equal(L.superLeft({}, 3), 3);
  assert.equal(L.superLeft({ a: "s", b: "y", c: "s" }, 3), 1);
  assert.equal(L.superLeft({ a: "s", b: "s", c: "s", d: "s" }, 3), 0);
});

test("results for 2 players: both yes = match, one yes = almost, sorted by score", () => {
  const r = L.computeResults(deck, [{ a: "y", b: "s", c: "n", d: "s" }, { a: "y", b: "s", c: "y", d: "n" }]);
  assert.deepEqual(ids(r.matches), ["b", "a"]);
  assert.equal(r.matches[0].perfect, true);
  assert.equal(r.matches[0].score, 4);
  assert.deepEqual(ids(r.almost), ["d", "c"]);
});

test("results for 4 players: match needs everyone, almost = all but one", () => {
  const v = [
    { a: "y", b: "y", c: "y" },
    { a: "y", b: "y", c: "n" },
    { a: "s", b: "n", c: "n" },
    { a: "y", b: "y", c: "n" }
  ];
  const r = L.computeResults(deck, v);
  assert.deepEqual(ids(r.matches), ["a"]);
  assert.deepEqual(ids(r.almost), ["b"]);       // 3 of 4
  assert.deepEqual(r.almost[0].yes, [0, 1, 3]); // who said yes
});

test("missing answers count as skip", () => {
  const r = L.computeResults(deck, [{ a: "y" }, {}]);
  assert.equal(r.matches.length, 0);
  assert.equal(r.almost.length, 1);
});

// ---------- draw ----------
test("pickWinner: null with nothing, always a member, weighted by score", () => {
  assert.equal(L.pickWinner([], L.makeRng(1)), null);
  const r = L.computeResults(deck, [{ a: "s", b: "y" }, { a: "s", b: "y" }]);
  const rng = L.makeRng(123);
  let aWins = 0;
  for (let i = 0; i < 3000; i++) {
    const w = L.pickWinner(r.matches, rng);
    assert.ok(r.matches.includes(w));
    if (w.movie.id === "a") aWins++;
  }
  // a has score 4, b has score 2 → expected share 4/6
  assert.ok(aWins / 3000 > 0.6 && aWins / 3000 < 0.73, `share ${aWins / 3000}`);
});

// ---------- fun facts ----------
test("fun facts name the pickiest player and the most in-sync pair", () => {
  const names = ["Kim", "Sam", "Ola"];
  const v = [{ a: "y", b: "y", c: "y", d: "y" }, { a: "y", b: "n", c: "n", d: "n" }, { a: "y", b: "y", c: "y", d: "n" }];
  const f = L.funFacts(names, deck, v);
  const get = label => f.find(x => x.label === label).text;
  assert.match(get("Pickiest"), /^Sam said yes to 1 of 4/);
  assert.match(get("Easiest to please"), /^Kim/);
  assert.match(get("Most in sync"), /Kim & Ola agreed on 75%/);
});

// ---------- showdown ----------
function playShowdown(n, pickFn) {
  const items = Array.from({ length: n }, (_, i) => ({ movie: { id: "m" + i, title: "M" + i }, score: n - i }));
  let s = L.createShowdown(items), matches = 0;
  assert.equal(L.showdownMatchesLeft(s), Math.min(n, 8) - 1);
  while (!L.showdownWinner(s)) {
    const pair = L.showdownPair(s);
    assert.ok(pair[0] && pair[1] && pair[0] !== pair[1], "a real pair");
    s = L.showdownChoose(s, pickFn(pair));
    matches++;
    assert.ok(matches < 20, "terminates");
  }
  return { winner: L.showdownWinner(s), matches, s };
}

test("showdown: a bracket of k entries takes exactly k-1 picks, for k = 2..8", () => {
  for (let k = 2; k <= 8; k++) assert.equal(playShowdown(k, () => 0).matches, k - 1, `k=${k}`);
});

test("showdown: always picking one movie makes it win; max 8 entries", () => {
  const { winner } = playShowdown(6, pair => (pair[0].movie.id === "m4" ? 0 : pair[1].movie.id === "m4" ? 1 : 0));
  assert.equal(winner.movie.id, "m4");
  assert.equal(playShowdown(12, () => 0).matches, 7);
});

test("showdown: choosing does not change the previous state", () => {
  const items = [1, 2, 3, 4].map(i => ({ movie: { id: "x" + i }, score: i }));
  const s0 = L.createShowdown(items);
  const before = JSON.stringify(s0);
  L.showdownChoose(s0, 1);
  assert.equal(JSON.stringify(s0), before);
});

// ---------- share links ----------
test("session link round-trips players, deck and answers (incl. æøå in names)", () => {
  const d = L.buildDeck(MOVIES, {}, 20, L.makeRng(5)).map(m => m.id);
  const v1 = {}; d.forEach((id, i) => v1[id] = i % 3 === 0 ? "s" : i % 2 ? "y" : "n");
  const session = { players: ["Kåre", "Øystein", "Ane"], deck: d, votes: [v1], limit: 3 };
  const code = L.encodeSession(session);
  assert.match(code, /^[A-Za-z0-9_-]+$/, "URL-safe");
  const back = L.decodeSession(code, MOVIES);
  assert.deepEqual(back, session);
});

test("decodeSession rejects garbage and drops unknown movie ids", () => {
  assert.equal(L.decodeSession("not-a-real-code", MOVIES), null);
  assert.equal(L.decodeSession("", MOVIES), null);
  const real = MOVIES[0].id;
  const code = L.encodeSession({ players: ["A", "B"], deck: [real, "zzzzzzz"], votes: [{ [real]: "y", zzzzzzz: "s" }], limit: 3 });
  const back = L.decodeSession(code, MOVIES);
  assert.deepEqual(back.deck, [real]);
  assert.deepEqual(back.votes, [{ [real]: "y" }]);
});

test("a full 20-movie, 6-player link stays a reasonable length", () => {
  const d = L.buildDeck(MOVIES, {}, 20, L.makeRng(9)).map(m => m.id);
  const votes = Array.from({ length: 6 }, () => Object.fromEntries(d.map(id => [id, "y"])));
  const code = L.encodeSession({ players: ["Player 1", "Player 2", "Player 3", "Player 4", "Player 5", "Player 6"], deck: d, votes, limit: 3 });
  assert.ok(code.length < 1000, `length ${code.length}`);
});

// ---------- text ----------
test("resultsToText lists the winner and the matches", () => {
  const r = L.computeResults(deck, [{ a: "y" }, { a: "s" }]);
  const txt = L.resultsToText(["Kim", "Sam"], r, r.matches[0]);
  assert.match(txt, /Movie night: Kim, Sam/);
  assert.match(txt, /Tonight we watch: Alpha \(1985\)/);
});
