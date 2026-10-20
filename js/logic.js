/*
 * Movie Night Matcher: pure game logic.
 * No DOM code in here, so the same file runs in the browser and in Node tests.
 */
(function (root) {
  "use strict";

  // How much each answer is worth. "s" = must watch, "y" = yes, "n" = skip.
  var POINTS = { n: 0, y: 1, s: 2 };
  var MAX_PLAYERS = 6;
  var MIN_PLAYERS = 2;

  // ---------------------------------------------------------------- random
  // Small seeded random generator (mulberry32) so tests are repeatable.
  function makeRng(seed) {
    var t = seed >>> 0;
    return function () {
      t += 0x6d2b79f5;
      var r = Math.imul(t ^ (t >>> 15), 1 | t);
      r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Fisher-Yates shuffle. Returns a new array, never changes the input.
  function shuffle(list, rng) {
    var rand = rng || Math.random;
    var copy = list.slice();
    for (var i = copy.length - 1; i > 0; i--) {
      var j = Math.floor(rand() * (i + 1));
      var tmp = copy[i]; copy[i] = copy[j]; copy[j] = tmp;
    }
    return copy;
  }

  // ---------------------------------------------------------------- catalogue helpers
  function has(m, g) { return m.genres.indexOf(g) !== -1; }

  // "Tonight's vibe" presets. Each is a rule on genres/runtime, so no extra data is needed.
  var VIBES = [
    { id: "feelgood", label: "Feel-good", test: function (m) {
      return (has(m, "Comedy") || has(m, "Family") || has(m, "Animation") || has(m, "Musical")) &&
        !has(m, "Horror") && !has(m, "War") && !has(m, "Crime") && !has(m, "Thriller");
    } },
    { id: "laughs", label: "Big laughs", test: function (m) { return has(m, "Comedy") && !has(m, "Horror") && !has(m, "War"); } },
    { id: "date", label: "Date night", test: function (m) { return has(m, "Romance"); } },
    { id: "thrills", label: "Edge of your seat", test: function (m) {
      return has(m, "Thriller") || (has(m, "Action") && !has(m, "Comedy") && !has(m, "Animation"));
    } },
    { id: "scary", label: "Scary", test: function (m) { return has(m, "Horror"); } },
    { id: "mind", label: "Mind-bending", test: function (m) {
      return has(m, "Sci-Fi") && (has(m, "Mystery") || has(m, "Drama") || has(m, "Thriller"));
    } },
    { id: "epic", label: "Epic", test: function (m) {
      return m.runtime >= 145 && (has(m, "Adventure") || has(m, "History") || has(m, "War") || has(m, "Fantasy") || has(m, "Sci-Fi"));
    } },
    { id: "kids", label: "With kids", test: function (m) {
      return has(m, "Family") && !has(m, "Horror") && !has(m, "War");
    } },
    { id: "true", label: "True stories", test: function (m) { return has(m, "History") || has(m, "Documentary"); } }
  ];

  // Where a movie comes from, grouped for the "Made in" filter.
  var REGIONS = [
    { id: "no", label: "Norway", codes: ["NO"] },
    { id: "nordic", label: "Nordic", codes: ["NO", "SE", "DK", "FI", "IS"] },
    { id: "us", label: "USA", codes: ["US"] },
    { id: "uk", label: "UK & Ireland", codes: ["GB", "IE"] },
    { id: "europe", label: "Europe", codes: ["NO", "SE", "DK", "FI", "IS", "GB", "IE", "FR", "DE", "IT", "ES", "LV"] },
    { id: "asia", label: "Asia", codes: ["KR", "JP", "CN", "HK", "TW", "IN", "IR"] },
    { id: "world", label: "Outside the US", codes: null }
  ];

  function findById(list, id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function allGenres(movies) {
    var seen = {};
    movies.forEach(function (m) { m.genres.forEach(function (g) { seen[g] = true; }); });
    return Object.keys(seen).sort();
  }

  /*
   * Filter options (all optional):
   *   genres: ["Comedy", ...]   any of these (empty = all)
   *   vibe: "feelgood"          one VIBES id
   *   region: "nordic"          one REGIONS id
   *   fromYear / toYear         inclusive
   *   maxRuntime                minutes, 0 = any
   *   exclude: { id: true }     e.g. movies marked as seen
   */
  function filterMovies(movies, options) {
    var o = options || {};
    var genres = o.genres || [];
    var vibe = o.vibe ? findById(VIBES, o.vibe) : null;
    var region = o.region ? findById(REGIONS, o.region) : null;
    var exclude = o.exclude || {};
    return movies.filter(function (m) {
      if (exclude[m.id]) return false;
      if (o.maxRuntime && m.runtime > o.maxRuntime) return false;
      if (o.fromYear && m.year < o.fromYear) return false;
      if (o.toYear && m.year > o.toYear) return false;
      if (vibe && !vibe.test(m)) return false;
      if (region) {
        if (region.codes === null ? m.country === "US" : region.codes.indexOf(m.country) === -1) return false;
      }
      if (genres.length && !m.genres.some(function (g) { return genres.indexOf(g) !== -1; })) return false;
      return true;
    });
  }

  function buildDeck(movies, options, size, rng) {
    return shuffle(filterMovies(movies, options), rng).slice(0, size);
  }

  // ---------------------------------------------------------------- answers
  // How many "must watch" answers a player has left.
  function superLeft(votes, limit) {
    var used = 0;
    for (var k in votes) if (votes[k] === "s") used++;
    return Math.max(0, limit - used);
  }

  /*
   * Compare everyone's answers on the same deck.
   * votesList = [ { movieId: "y" | "n" | "s" }, ... ] one object per player.
   * Returns:
   *   matches: everyone said yes        (sorted by score)
   *   almost:  everyone but one said yes (3+ players) / exactly one said yes (2 players)
   * Each item: { movie, score, yes: [playerIndex], supers: [playerIndex], perfect }
   */
  function computeResults(deck, votesList) {
    var n = votesList.length;
    var matches = [], almost = [];
    deck.forEach(function (movie) {
      var yes = [], supers = [], score = 0;
      votesList.forEach(function (votes, p) {
        var v = votes[movie.id];
        var pts = POINTS[v] || 0;
        score += pts;
        if (pts > 0) yes.push(p);
        if (v === "s") supers.push(p);
      });
      var item = { movie: movie, score: score, yes: yes, supers: supers, perfect: supers.length === n };
      if (yes.length === n) matches.push(item);
      else if (yes.length > 0 && yes.length >= n - 1) almost.push(item);
    });
    var byScore = function (a, b) {
      return b.score - a.score || b.yes.length - a.yes.length || a.movie.title.localeCompare(b.movie.title);
    };
    matches.sort(byScore);
    almost.sort(byScore);
    return { matches: matches, almost: almost };
  }

  // Weighted raffle: each item gets tickets equal to its score.
  function pickWinner(items, rng) {
    if (!items || items.length === 0) return null;
    var rand = rng || Math.random;
    var total = items.reduce(function (sum, m) { return sum + Math.max(1, m.score); }, 0);
    var ticket = rand() * total;
    for (var i = 0; i < items.length; i++) {
      ticket -= Math.max(1, items[i].score);
      if (ticket < 0) return items[i];
    }
    return items[items.length - 1];
  }

  // Fun facts about the group. Returns a list of { label, text }.
  function funFacts(names, deck, votesList) {
    var facts = [];
    if (!deck.length) return facts;
    var said = function (votes, m) { return (POINTS[votes[m.id]] || 0) > 0; };
    var yesCounts = votesList.map(function (votes) {
      return deck.filter(function (m) { return said(votes, m); }).length;
    });
    var max = Math.max.apply(null, yesCounts), min = Math.min.apply(null, yesCounts);
    if (max !== min) {
      facts.push({ label: "Easiest to please", text: names[yesCounts.indexOf(max)] + " said yes to " + max + " of " + deck.length });
      facts.push({ label: "Pickiest", text: names[yesCounts.indexOf(min)] + " said yes to " + min + " of " + deck.length });
    } else {
      facts.push({ label: "Equally picky", text: "Everyone said yes to " + max + " of " + deck.length });
    }
    // Most in sync pair: same answer (yes or skip) on the most movies.
    var best = null;
    for (var a = 0; a < votesList.length; a++) {
      for (var b = a + 1; b < votesList.length; b++) {
        var same = deck.filter(function (m) { return said(votesList[a], m) === said(votesList[b], m); }).length;
        if (!best || same > best.same) best = { a: a, b: b, same: same };
      }
    }
    if (best) {
      facts.push({
        label: votesList.length === 2 ? "In sync" : "Most in sync",
        text: names[best.a] + " & " + names[best.b] + " agreed on " + Math.round(best.same / deck.length * 100) + "%"
      });
    }
    return facts;
  }

  // ---------------------------------------------------------------- showdown
  // Single-elimination bracket (max 8). Seeded best vs worst in round one.
  function createShowdown(items) {
    var list = items.slice(0, 8);
    var seeded = [];
    var i = 0, j = list.length - 1;
    while (i <= j) { seeded.push(list[i++]); if (i <= j) seeded.push(list[j--]); }
    return advance({ round: 1, current: seeded, next: [], pos: 0, history: [] });
  }

  // Moves an unpaired item straight through, and starts the next round when one ends.
  function advance(s) {
    if (s.current.length > 1 && s.pos === s.current.length - 1) {
      s.next.push(s.current[s.pos]);
      s.pos++;
    }
    if (s.pos >= s.current.length && s.next.length) {
      s.current = s.next; s.next = []; s.pos = 0; s.round++;
      return advance(s);
    }
    return s;
  }

  function showdownPair(s) {
    return s.current.length < 2 ? null : [s.current[s.pos], s.current[s.pos + 1]];
  }
  function showdownWinner(s) {
    return s.current.length === 1 ? s.current[0] : null;
  }
  // pick = 0 or 1 (left or right). Returns a new state; the old one is not changed.
  function showdownChoose(state, pick) {
    var s = { round: state.round, current: state.current.slice(), next: state.next.slice(), pos: state.pos, history: state.history.slice() };
    var pair = showdownPair(s);
    if (!pair) return s;
    s.next.push(pair[pick]);
    s.history.push({ round: s.round, winner: pair[pick], loser: pair[1 - pick] });
    s.pos += 2;
    return advance(s);
  }
  // Matches still to play: a bracket always needs (entrants still alive - 1).
  function showdownMatchesLeft(s) {
    if (s.current.length === 1) return 0;
    return (s.current.length - s.pos) + s.next.length - 1;
  }

  // ---------------------------------------------------------------- share links
  // A whole game fits in a URL, so friends can swipe on their own phones without a server.
  // Session: { players: [names], deck: [ids], votes: [ {id: "y"|"n"|"s"} per finished player ], limit, winner? }
  function toBase64Url(str) {
    var bytes = typeof TextEncoder !== "undefined" ? new TextEncoder().encode(str) : Buffer.from(str, "utf8");
    var bin = "";
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    var b64 = typeof btoa !== "undefined" ? btoa(bin) : Buffer.from(bin, "binary").toString("base64");
    return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function fromBase64Url(s) {
    var b64 = String(s).replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    var bin = typeof atob !== "undefined" ? atob(b64) : Buffer.from(b64, "base64").toString("binary");
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return typeof TextDecoder !== "undefined" ? new TextDecoder().decode(bytes) : Buffer.from(bytes).toString("utf8");
  }

  function votesToString(deckIds, votes) {
    return deckIds.map(function (id) { return votes[id] === "s" ? "s" : votes[id] === "y" ? "y" : "n"; }).join("");
  }
  function votesFromString(deckIds, str) {
    var out = {};
    deckIds.forEach(function (id, i) { var c = str.charAt(i); out[id] = c === "s" || c === "y" ? c : "n"; });
    return out;
  }

  function encodeSession(session) {
    return toBase64Url(JSON.stringify({
      v: 1,
      p: session.players,
      d: session.deck.join("."),
      a: session.votes.map(function (votes) { return votesToString(session.deck, votes); }),
      l: session.limit,
      w: session.winner || undefined,
      r: session.room || undefined
    }));
  }

  // ---------------------------------------------------------------- live updates
  // With a room id, phones also swap answers through a public message relay (ntfy.sh), so results
  // show up everywhere without sending links back. The links still work on their own as a fallback.
  var ROOM_RE = /^[A-Za-z0-9_-]{16,40}$/;
  function liveVotes(deckIds, player, votes) {
    return JSON.stringify({ v: 1, k: "votes", p: player, a: votesToString(deckIds, votes) });
  }
  function livePick(movieId) {
    return JSON.stringify({ v: 1, k: "pick", w: movieId });
  }
  // Anyone who knows the room can post to it, so every message is checked against the game.
  // Returns { kind: "votes", player, votes } or { kind: "pick", id }, or null if it doesn't fit.
  function parseLive(text, deckIds, playerCount) {
    try {
      var o = JSON.parse(text);
      if (!o || o.v !== 1) return null;
      if (o.k === "votes") {
        var p = o.p;
        if (typeof p !== "number" || p % 1 !== 0 || p < 0 || p >= playerCount) return null;
        if (typeof o.a !== "string" || o.a.length !== deckIds.length || !/^[yns]*$/.test(o.a)) return null;
        return { kind: "votes", player: p, votes: votesFromString(deckIds, o.a) };
      }
      if (o.k === "pick" && typeof o.w === "string" && deckIds.indexOf(o.w) !== -1) return { kind: "pick", id: o.w };
    } catch (e) { /* not ours */ }
    return null;
  }

  // Returns a session, or null if the code is broken. Unknown movie ids are dropped.
  function decodeSession(code, movies) {
    try {
      var o = JSON.parse(fromBase64Url(code));
      if (!o || o.v !== 1 || !Array.isArray(o.p) || typeof o.d !== "string" || !Array.isArray(o.a)) return null;
      var players = o.p.slice(0, MAX_PLAYERS).map(function (n) { return String(n).slice(0, 16).trim() || "Player"; });
      if (players.length < MIN_PLAYERS) return null;
      var allIds = o.d.split(".");
      var known = {};
      movies.forEach(function (m) { known[m.id] = true; });
      var deck = allIds.filter(function (id) { return known[id]; });
      if (!deck.length) return null;
      var votes = o.a.slice(0, players.length).map(function (str) {
        var full = votesFromString(allIds, String(str));
        var kept = {};
        deck.forEach(function (id) { kept[id] = full[id]; });
        return kept;
      });
      var limit = Number(o.l);
      var session = { players: players, deck: deck, votes: votes, limit: limit >= 0 && limit <= 50 ? limit : 3 };
      if (typeof o.w === "string" && deck.indexOf(o.w) !== -1) session.winner = o.w; // tonight's pick, if drawn
      if (typeof o.r === "string" && ROOM_RE.test(o.r)) session.room = o.r;
      return session;
    } catch (e) {
      return null;
    }
  }

  // ---------------------------------------------------------------- text export
  function resultsToText(names, results, winner) {
    var lines = ["Movie night: " + names.join(", ")];
    if (winner) lines.push("Tonight we watch: " + winner.movie.title + " (" + winner.movie.year + ")");
    if (results.matches.length) {
      lines.push("", "Everyone said yes:");
      results.matches.forEach(function (m) {
        lines.push("- " + m.movie.title + " (" + m.movie.year + ")" + (m.perfect ? ", everyone's must watch" : ""));
      });
    } else {
      lines.push("", "No movie got a yes from everyone this time.");
    }
    return lines.join("\n");
  }

  var api = {
    POINTS: POINTS, MAX_PLAYERS: MAX_PLAYERS, MIN_PLAYERS: MIN_PLAYERS, VIBES: VIBES, REGIONS: REGIONS,
    makeRng: makeRng, shuffle: shuffle, allGenres: allGenres, filterMovies: filterMovies, buildDeck: buildDeck,
    superLeft: superLeft, computeResults: computeResults, pickWinner: pickWinner, funFacts: funFacts,
    createShowdown: createShowdown, showdownPair: showdownPair, showdownChoose: showdownChoose,
    showdownWinner: showdownWinner, showdownMatchesLeft: showdownMatchesLeft,
    encodeSession: encodeSession, decodeSession: decodeSession, resultsToText: resultsToText,
    liveVotes: liveVotes, livePick: livePick, parseLive: parseLive
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MatchLogic = api;
})(this);
