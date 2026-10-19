/*
 * Movie Night Matcher: pure game logic.
 * No DOM code in here, so the same file runs in the browser and in Node tests.
 */
(function (root) {
  // How much each swipe is worth.
  var VOTE_POINTS = { no: 0, yes: 1, super: 2 };

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
      var tmp = copy[i];
      copy[i] = copy[j];
      copy[j] = tmp;
    }
    return copy;
  }

  // All genres that appear in the catalogue, sorted A-Z.
  function allGenres(movies) {
    var seen = {};
    movies.forEach(function (m) {
      m.genres.forEach(function (g) { seen[g] = true; });
    });
    return Object.keys(seen).sort();
  }

  // Keep movies that match ANY selected genre (none selected = all genres),
  // are not longer than maxRuntime, and are Norwegian if norwegianOnly is set.
  function filterMovies(movies, options) {
    var opts = options || {};
    var genres = opts.genres || [];
    var maxRuntime = opts.maxRuntime || Infinity;
    return movies.filter(function (m) {
      if (m.runtime > maxRuntime) return false;
      if (opts.norwegianOnly && !m.norwegian) return false;
      if (genres.length === 0) return true;
      return m.genres.some(function (g) { return genres.indexOf(g) !== -1; });
    });
  }

  // Pick `size` random movies that pass the filters.
  function buildDeck(movies, options, size, rng) {
    var pool = shuffle(filterMovies(movies, options), rng);
    return pool.slice(0, size);
  }

  // Compare both players' votes on the same deck.
  // votesA / votesB look like { movieId: "no" | "yes" | "super" }.
  function computeResults(deck, votesA, votesB) {
    var matches = [];
    var maybes = [];
    deck.forEach(function (movie) {
      var a = VOTE_POINTS[votesA[movie.id]] || 0;
      var b = VOTE_POINTS[votesB[movie.id]] || 0;
      if (a > 0 && b > 0) {
        matches.push({ movie: movie, a: a, b: b, score: a + b, perfect: a === 2 && b === 2 });
      } else if (a > 0 || b > 0) {
        maybes.push({ movie: movie, likedBy: a > 0 ? "a" : "b", score: a + b });
      }
    });
    var byScore = function (x, y) {
      return y.score - x.score || x.movie.title.localeCompare(y.movie.title);
    };
    matches.sort(byScore);
    maybes.sort(byScore);
    return { matches: matches, maybes: maybes };
  }

  // Draw tonight's movie. Each match gets tickets equal to its score,
  // so a double "must watch" (4 tickets) is twice as likely as two plain yeses (2).
  function pickWinner(matches, rng) {
    if (!matches || matches.length === 0) return null;
    var rand = rng || Math.random;
    var total = matches.reduce(function (sum, m) { return sum + m.score; }, 0);
    var ticket = rand() * total;
    for (var i = 0; i < matches.length; i++) {
      ticket -= matches[i].score;
      if (ticket < 0) return matches[i];
    }
    return matches[matches.length - 1];
  }

  // Plain-text summary for the "Copy results" button.
  function resultsToText(names, results, winner) {
    var lines = ["Movie night: " + names[0] + " + " + names[1]];
    if (winner) lines.push("Tonight we watch: " + winner.movie.title + " (" + winner.movie.year + ")");
    if (results.matches.length) {
      lines.push("", "Matches:");
      results.matches.forEach(function (m) {
        lines.push("- " + m.movie.title + (m.perfect ? " (both said must watch)" : ""));
      });
    } else {
      lines.push("", "No matches this time.");
    }
    return lines.join("\n");
  }

  var api = {
    VOTE_POINTS: VOTE_POINTS,
    makeRng: makeRng,
    shuffle: shuffle,
    allGenres: allGenres,
    filterMovies: filterMovies,
    buildDeck: buildDeck,
    computeResults: computeResults,
    pickWinner: pickWinner,
    resultsToText: resultsToText
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.MatchLogic = api;
  }
})(this);
