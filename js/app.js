/* Movie Night Matcher: UI and screen flow. Game rules live in logic.js. */
(function () {
  "use strict";

  var L = window.MatchLogic;
  var MOVIES = window.MOVIES;
  var HISTORY_KEY = "movie-night-matcher.history.v1";
  var SETTINGS_KEY = "movie-night-matcher.settings.v1";
  var SWIPE_DISTANCE = 100; // px a card must travel to count as an answer

  // Ticket colour per genre (first genre of a movie decides).
  var GENRE_COLORS = {
    "Action": "#ff9d5c", "Adventure": "#f6c343", "Animation": "#7fd8cc", "Comedy": "#ffb3c7",
    "Crime": "#bfcbe0", "Drama": "#cdb8f2", "Family": "#b2e57a", "Fantasy": "#a6c8ff",
    "History": "#dccba9", "Horror": "#ff8080", "Musical": "#ffd2a1", "Mystery": "#bfb2e0",
    "Romance": "#ff9fb4", "Sci-Fi": "#93e4f2", "Thriller": "#e8c992"
  };
  function colorFor(movie) { return GENRE_COLORS[movie.genres[0]] || "#ffb3c7"; }

  var $ = function (id) { return document.getElementById(id); };
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------- state ----------
  var state = {
    names: ["", ""],
    options: { genres: [], maxRuntime: 0, norwegianOnly: false },
    deckSize: 20,
    deck: [],
    orders: [[], []],   // each player sees the same movies in their own order
    player: 0,
    index: 0,
    votes: [{}, {}],
    undo: [],           // stack of { movieId } for the current player
    results: null,
    winner: null,
    busy: false         // true while a card is flying out
  };

  // ---------- storage (best effort; the app works without it) ----------
  function load(key, fallback) {
    try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
    catch (e) { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* ignore */ }
  }

  // ---------- helpers ----------
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function formatRuntime(min) {
    var h = Math.floor(min / 60), m = min % 60;
    return h + " h " + (m < 10 ? "0" : "") + m + " min";
  }
  function show(screenId) {
    document.querySelectorAll(".screen").forEach(function (s) {
      if (s.id === screenId) s.setAttribute("data-active", "");
      else s.removeAttribute("data-active");
    });
    window.scrollTo(0, 0);
  }
  var toastTimer;
  function toast(msg) {
    var t = $("toast");
    t.textContent = msg;
    t.classList.add("is-shown");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("is-shown"); }, 2200);
  }

  // =====================================================================
  // 1. SETUP
  // =====================================================================
  function buildGenreChips() {
    var box = $("genre-chips");
    L.allGenres(MOVIES).forEach(function (g) {
      var b = el("button", "chip", g);
      b.type = "button";
      b.dataset.genre = g;
      b.style.setProperty("--chip", GENRE_COLORS[g] || "");
      b.setAttribute("aria-pressed", state.options.genres.indexOf(g) !== -1 ? "true" : "false");
      b.addEventListener("click", function () {
        var on = b.getAttribute("aria-pressed") !== "true";
        b.setAttribute("aria-pressed", on ? "true" : "false");
        readOptions();
      });
      box.appendChild(b);
    });
  }

  function readOptions() {
    state.options.genres = Array.prototype.map.call(
      document.querySelectorAll('#genre-chips [aria-pressed="true"]'),
      function (b) { return b.dataset.genre; }
    );
    state.options.maxRuntime = Number($("max-runtime").value) || 0;
    state.options.norwegianOnly = $("norwegian-only").checked;
    updatePoolCount();
  }

  function updatePoolCount() {
    var n = L.filterMovies(MOVIES, state.options).length;
    var p = $("pool-count");
    var start = $("start-btn");
    if (n === 0) {
      p.textContent = "No movies fit these filters. Remove a genre or allow longer movies.";
      p.classList.add("pool-empty");
      start.disabled = true;
    } else {
      var size = Math.min(n, state.deckSize);
      p.textContent = n + " movies fit. You'll each swipe " + size + ".";
      p.classList.remove("pool-empty");
      start.disabled = false;
    }
  }

  function restoreSettings() {
    var s = load(SETTINGS_KEY, null);
    if (!s) return;
    $("name-a").value = s.names ? s.names[0] || "" : "";
    $("name-b").value = s.names ? s.names[1] || "" : "";
    if (s.options) {
      state.options.genres = s.options.genres || [];
      $("max-runtime").value = String(s.options.maxRuntime || 0);
      $("norwegian-only").checked = !!s.options.norwegianOnly;
    }
    if (s.deckSize) setDeckSize(s.deckSize);
  }

  function setDeckSize(size) {
    state.deckSize = size;
    document.querySelectorAll("#deck-size button").forEach(function (b) {
      b.setAttribute("aria-pressed", Number(b.dataset.size) === size ? "true" : "false");
    });
    updatePoolCount();
  }

  function startGame() {
    readOptions();
    state.names = [
      $("name-a").value.trim() || "Player 1",
      $("name-b").value.trim() || "Player 2"
    ];
    if (state.names[0].toLowerCase() === state.names[1].toLowerCase()) {
      state.names[1] = state.names[1] + " 2";
    }
    save(SETTINGS_KEY, { names: [$("name-a").value.trim(), $("name-b").value.trim()], options: state.options, deckSize: state.deckSize });
    newRound();
  }

  function newRound() {
    state.deck = L.buildDeck(MOVIES, state.options, state.deckSize);
    if (state.deck.length === 0) { show("screen-setup"); updatePoolCount(); return; }
    state.orders = [L.shuffle(state.deck), L.shuffle(state.deck)];
    state.votes = [{}, {}];
    state.player = 0;
    state.results = null;
    state.winner = null;
    startTurn();
  }

  // =====================================================================
  // 2. SWIPING
  // =====================================================================
  function startTurn() {
    state.index = 0;
    state.undo = [];
    state.busy = false;
    $("turn-name").textContent = state.names[state.player];
    show("screen-swipe");
    renderStack();
  }

  function currentOrder() { return state.orders[state.player]; }

  function renderTicket(movie, number) {
    var t = el("article", "ticket");
    t.style.setProperty("--tk", colorFor(movie));
    t.dataset.id = movie.id;
    t.setAttribute("aria-label", movie.title + ", " + movie.year);

    var yr = el("span", "ticket-year", String(movie.year));
    yr.setAttribute("aria-hidden", "true");
    t.appendChild(yr);

    var main = el("div", "ticket-main");
    var genres = movie.genres.join(", ") + (movie.norwegian ? ", Norwegian film" : "");
    main.appendChild(el("p", "ticket-genres", genres));
    var title = el("h2", "ticket-title" + (movie.title.length > 26 ? " is-long" : ""), movie.title);
    main.appendChild(title);
    main.appendChild(el("p", "ticket-pitch", movie.pitch));
    t.appendChild(main);

    var stub = el("div", "ticket-stub");
    [["Year", movie.year], ["Length", formatRuntime(movie.runtime)], ["Ticket", "No. " + String(number).padStart(3, "0")]]
      .forEach(function (pair) {
        var s = el("span");
        s.appendChild(el("small", null, pair[0]));
        s.appendChild(document.createTextNode(pair[1]));
        stub.appendChild(s);
      });
    t.appendChild(stub);

    t.appendChild(el("span", "stamp stamp-yes", "Yes"));
    t.appendChild(el("span", "stamp stamp-no", "Skip"));
    t.appendChild(el("span", "stamp stamp-super", "Must watch"));
    return t;
  }

  function renderStack() {
    var stack = $("stack");
    stack.innerHTML = "";
    var order = currentOrder();
    var total = order.length;
    $("turn-count").textContent = Math.min(state.index + 1, total) + " of " + total;
    $("progress-bar").style.width = (state.index / total * 100) + "%";
    $("undo-btn").disabled = state.undo.length === 0;

    var next = order[state.index + 1];
    if (next) {
      var n = renderTicket(next, state.index + 2);
      n.classList.add("is-next");
      n.setAttribute("aria-hidden", "true");
      stack.appendChild(n);
    }
    var top = order[state.index];
    if (top) {
      var t = renderTicket(top, state.index + 1);
      stack.appendChild(t);
      attachDrag(t);
    }
  }

  function setStamps(card, dx, dy) {
    var yes = Math.max(0, Math.min(1, dx / SWIPE_DISTANCE));
    var no = Math.max(0, Math.min(1, -dx / SWIPE_DISTANCE));
    var sup = Math.max(0, Math.min(1, -dy / SWIPE_DISTANCE));
    if (sup > Math.max(yes, no)) { yes = 0; no = 0; } else { sup = 0; }
    card.querySelector(".stamp-yes").style.opacity = yes;
    card.querySelector(".stamp-no").style.opacity = no;
    card.querySelector(".stamp-super").style.opacity = sup;
  }

  function attachDrag(card) {
    var startX = 0, startY = 0, dx = 0, dy = 0, dragging = false, pointerId = null;

    card.addEventListener("pointerdown", function (e) {
      if (state.busy || (e.pointerType === "mouse" && e.button !== 0)) return;
      dragging = true;
      pointerId = e.pointerId;
      startX = e.clientX; startY = e.clientY; dx = 0; dy = 0;
      card.setPointerCapture(pointerId);
      card.classList.add("is-dragging");
      card.classList.remove("is-returning");
    });

    card.addEventListener("pointermove", function (e) {
      if (!dragging || e.pointerId !== pointerId) return;
      dx = e.clientX - startX;
      dy = e.clientY - startY;
      card.style.transform = "translate(" + dx + "px," + dy + "px) rotate(" + (dx / 18) + "deg)";
      setStamps(card, dx, dy);
    });

    function end(e) {
      if (!dragging || e.pointerId !== pointerId) return;
      dragging = false;
      card.classList.remove("is-dragging");
      var vote = null;
      if (-dy > SWIPE_DISTANCE && Math.abs(dy) > Math.abs(dx)) vote = "super";
      else if (dx > SWIPE_DISTANCE) vote = "yes";
      else if (dx < -SWIPE_DISTANCE) vote = "no";

      if (vote) {
        answer(vote, { dx: dx, dy: dy });
      } else {
        card.classList.add("is-returning");
        card.style.transform = "";
        setStamps(card, 0, 0);
      }
    }
    card.addEventListener("pointerup", end);
    card.addEventListener("pointercancel", end);
  }

  function answer(vote, from) {
    if (state.busy) return;
    var order = currentOrder();
    var movie = order[state.index];
    if (!movie) return;
    state.busy = true;

    state.votes[state.player][movie.id] = vote;
    state.undo.push(movie.id);

    var card = $("stack").querySelector(".ticket:not(.is-next)");
    var finish = function () {
      state.index++;
      state.busy = false;
      if (state.index >= order.length) {
        // clear the finished stack so no invisible card is left behind
        $("stack").innerHTML = "";
        $("progress-bar").style.width = "100%";
        endTurn();
      } else {
        renderStack();
      }
    };

    if (!card || reduceMotion) { finish(); return; }

    var w = window.innerWidth;
    var x = vote === "yes" ? w : vote === "no" ? -w : (from ? from.dx : 0);
    var y = vote === "super" ? -window.innerHeight : (from ? from.dy : 0);
    setStamps(card, vote === "yes" ? 200 : vote === "no" ? -200 : 0, vote === "super" ? -200 : 0);
    card.classList.add("is-flying");
    // next frame so the transition runs
    requestAnimationFrame(function () {
      card.style.transform = "translate(" + x + "px," + y + "px) rotate(" + (x / 18) + "deg)";
      card.style.opacity = "0";
    });
    var done = false;
    var once = function () { if (!done) { done = true; finish(); } };
    card.addEventListener("transitionend", once, { once: true });
    setTimeout(once, 400); // safety net if transitionend never fires
  }

  function undoLast() {
    if (state.busy || state.undo.length === 0) return;
    var id = state.undo.pop();
    delete state.votes[state.player][id];
    state.index = Math.max(0, state.index - 1);
    renderStack();
  }

  function endTurn() {
    if (state.player === 0) {
      $("handoff-from").textContent = state.names[0];
      $("handoff-to").textContent = state.names[1];
      $("handoff-btn").textContent = "I'm " + state.names[1] + ", start";
      show("screen-handoff");
      $("handoff-btn").focus();
    } else {
      showResults();
    }
  }

  // =====================================================================
  // 4. RESULTS
  // =====================================================================
  function badgeFor(m) {
    if (m.perfect) return "Both: must watch";
    if (m.score === 3) return "Must watch + yes";
    return "Both: yes";
  }

  function resultRow(movie, badge) {
    var li = el("li");
    li.style.setProperty("--tk", colorFor(movie));
    li.dataset.id = movie.id;
    var info = el("span");
    info.appendChild(el("span", "r-title", movie.title));
    info.appendChild(el("span", "r-meta", movie.year + ", " + formatRuntime(movie.runtime)));
    li.appendChild(info);
    li.appendChild(el("span", "r-badge", badge));
    return li;
  }

  function showResults() {
    var a = state.names[0], b = state.names[1];
    var r = L.computeResults(state.deck, state.votes[0], state.votes[1]);
    state.results = r;
    state.winner = null;

    var n = r.matches.length;
    $("results-title").textContent = n === 0 ? "No matches this time"
      : n === 1 ? "You matched on 1 movie" : "You matched on " + n + " movies";
    $("results-lead").textContent = n === 0
      ? (r.maybes.length ? "Nothing got a yes from both of you. Below is what one of you liked, or try a new stack." : "Tough crowd. Try a new stack or change the genres.")
      : n === 1 ? "Easy choice. Draw it to make it official."
      : "Draw tonight's movie. Must-watch answers give a movie more tickets in the draw.";

    var ml = $("matches-list");
    ml.innerHTML = "";
    r.matches.forEach(function (m) { ml.appendChild(resultRow(m.movie, badgeFor(m))); });
    $("matches-block").hidden = n === 0;

    var yl = $("maybes-list");
    yl.innerHTML = "";
    r.maybes.forEach(function (m) {
      yl.appendChild(resultRow(m.movie, "Only " + (m.likedBy === "a" ? a : b)));
    });
    $("maybes-block").hidden = r.maybes.length === 0;

    $("admit").hidden = true;
    $("draw-btn").hidden = n === 0;
    $("draw-btn").disabled = false;
    $("draw-btn").textContent = "Draw tonight's movie";

    show("screen-results");
    addHistory(null);
  }

  function draw() {
    var r = state.results;
    if (!r || r.matches.length === 0) return;
    var winner = L.pickWinner(r.matches);
    state.winner = winner;

    var admit = $("admit");
    var title = $("admit-title");
    $("admit-who").textContent = state.names[0] + " & " + state.names[1] + " are watching";
    admit.hidden = false;
    admit.classList.remove("is-landed");
    $("draw-btn").disabled = true;

    var land = function () {
      admit.classList.remove("is-spinning");
      title.textContent = winner.movie.title;
      $("admit-meta").textContent = winner.movie.year + ", " + formatRuntime(winner.movie.runtime);
      void admit.offsetWidth; // restart animation
      admit.classList.add("is-landed");
      $("draw-btn").disabled = false;
      $("draw-btn").textContent = "Draw again";
      document.querySelectorAll("#matches-list li").forEach(function (li) {
        li.classList.toggle("is-winner", Number(li.dataset.id) === winner.movie.id);
      });
      updateLastHistory(winner.movie.title);
    };

    if (reduceMotion || r.matches.length === 1) { land(); return; }

    // Spin through the matches, slowing down, then land on the winner.
    admit.classList.add("is-spinning");
    $("admit-meta").textContent = "Drawing…";
    var steps = 16, i = 0, k = Math.floor(Math.random() * r.matches.length);
    (function tick() {
      title.textContent = r.matches[(k + i) % r.matches.length].movie.title;
      i++;
      if (i >= steps) { land(); return; }
      setTimeout(tick, 50 + i * i * 1.6);
    })();
  }

  function copyResults() {
    var text = L.resultsToText(state.names, state.results, state.winner);
    var ok = function () { toast("Results copied"); };
    var fallback = function () {
      var ta = el("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); ok(); } catch (e) { toast("Couldn't copy. Select the text manually."); }
      document.body.removeChild(ta);
    };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(ok, fallback);
    } else {
      fallback();
    }
  }

  // ---------- history ----------
  function addHistory(winnerTitle) {
    var list = load(HISTORY_KEY, []);
    list.unshift({
      date: new Date().toISOString(),
      names: state.names.slice(),
      matches: state.results.matches.length,
      winner: winnerTitle
    });
    save(HISTORY_KEY, list.slice(0, 10));
    renderHistory();
  }
  function updateLastHistory(winnerTitle) {
    var list = load(HISTORY_KEY, []);
    if (list.length) { list[0].winner = winnerTitle; save(HISTORY_KEY, list); }
    renderHistory();
  }
  function renderHistory() {
    var list = load(HISTORY_KEY, []);
    var box = $("history");
    var ol = $("history-list");
    ol.innerHTML = "";
    box.hidden = list.length === 0;
    list.forEach(function (h) {
      var li = el("li");
      var d = new Date(h.date);
      var when = d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
      li.appendChild(document.createTextNode(when + ": " + h.names[0] + " & " + h.names[1] + ", "));
      if (h.winner) {
        li.appendChild(document.createTextNode("watched "));
        li.appendChild(el("strong", null, h.winner));
      } else {
        li.appendChild(document.createTextNode(h.matches === 1 ? "1 match" : h.matches + " matches"));
      }
      ol.appendChild(li);
    });
  }

  // =====================================================================
  // wiring
  // =====================================================================
  function init() {
    restoreSettings();
    buildGenreChips();
    readOptions();
    renderHistory();

    $("setup-form").addEventListener("submit", function (e) { e.preventDefault(); startGame(); });
    $("max-runtime").addEventListener("change", readOptions);
    $("norwegian-only").addEventListener("change", readOptions);
    document.querySelectorAll("#deck-size button").forEach(function (b) {
      b.addEventListener("click", function () { setDeckSize(Number(b.dataset.size)); });
    });
    $("clear-history").addEventListener("click", function () {
      save(HISTORY_KEY, []);
      renderHistory();
      toast("History cleared");
    });

    document.querySelectorAll(".actions [data-vote]").forEach(function (b) {
      b.addEventListener("click", function () { answer(b.dataset.vote); });
    });
    $("undo-btn").addEventListener("click", undoLast);

    $("handoff-btn").addEventListener("click", function () { state.player = 1; startTurn(); });

    $("draw-btn").addEventListener("click", draw);
    $("copy-btn").addEventListener("click", copyResults);
    $("rematch-btn").addEventListener("click", newRound);
    $("settings-btn").addEventListener("click", function () { show("screen-setup"); });

    document.addEventListener("keydown", function (e) {
      if (!$("screen-swipe").hasAttribute("data-active")) return;
      if (e.target.closest && e.target.closest("input, select, textarea")) return;
      var map = { ArrowRight: "yes", ArrowLeft: "no", ArrowUp: "super" };
      if (map[e.key]) { e.preventDefault(); answer(map[e.key]); }
      else if (e.key === "Backspace" || (e.key === "z" && (e.ctrlKey || e.metaKey))) { e.preventDefault(); undoLast(); }
    });
  }

  init();
})();
