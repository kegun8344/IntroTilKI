/* Movie Night Matcher: UI and screen flow. Game rules live in logic.js. */
(function () {
  "use strict";

  var L = window.MatchLogic;
  var MOVIES = window.MOVIES;
  var COUNTRIES = window.COUNTRIES || {};
  var BY_ID = {};
  MOVIES.forEach(function (m) { BY_ID[m.id] = m; });

  var KEYS = {
    settings: "mnm.settings.v2",
    history: "mnm.history.v1",
    seen: "mnm.seen.v1"
  };
  var SWIPE_DISTANCE = 100;   // px a card must travel to count as an answer
  var SUPER_LIMIT = 3;        // must-watch answers per person per round
  var DEFAULT_OPTIONS = { genres: [], vibe: "", region: "", fromYear: 0, toYear: 0, maxRuntime: 0, hideSeen: true };

  // Ticket colour per genre (first genre of a movie decides).
  var GENRE_COLORS = {
    "Action": "#ff9d5c", "Adventure": "#f6c343", "Animation": "#7fd8cc", "Comedy": "#ffb3c7",
    "Crime": "#bfcbe0", "Documentary": "#d9e3a3", "Drama": "#cdb8f2", "Family": "#b2e57a",
    "Fantasy": "#a6c8ff", "History": "#dccba9", "Horror": "#ff8080", "Musical": "#ffd2a1",
    "Mystery": "#bfb2e0", "Romance": "#ff9fb4", "Sci-Fi": "#93e4f2", "Sport": "#9fe0b8",
    "Thriller": "#e8c992", "War": "#c9c2b0", "Western": "#f0b98a"
  };
  function colorFor(movie) { return GENRE_COLORS[movie.genres[0]] || "#ffb3c7"; }

  var $ = function (id) { return document.getElementById(id); };
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // =====================================================================
  // state
  // =====================================================================
  var state = {
    mode: "phone",          // "phone" = pass one phone, "link" = each on own phone
    names: [],
    options: clone(DEFAULT_OPTIONS),
    deckSize: 20,
    deck: [],
    order: [],              // current player's order of the deck
    player: 0,
    index: 0,
    votes: [],              // one { id: "y"|"n"|"s" } per player
    undo: [],
    recent: {},             // ids shown this sitting, avoided on "new stack"
    results: null,
    pool: [],               // what the draw / showdown picks from
    winner: null,
    joined: false,          // true when this device opened someone else's link
    showdown: null,
    busy: false
  };

  // ---------- storage (best effort: the app works without it) ----------
  function load(key, fallback) {
    try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
    catch (e) { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* private mode etc. */ }
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  var seen = load(KEYS.seen, {});

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
  function countryName(code) { return COUNTRIES[code] || code; }
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
    toastTimer = setTimeout(function () { t.classList.remove("is-shown"); }, 2400);
  }
  function trailerUrl(m) {
    return "https://www.youtube.com/results?search_query=" + encodeURIComponent(m.title + " " + m.year + " trailer");
  }
  function streamUrl(m) {
    return "https://www.justwatch.com/no/search?q=" + encodeURIComponent(m.title);
  }
  function externalLink(text, href) {
    var a = el("a", "chip-link", text);
    a.href = href; a.target = "_blank"; a.rel = "noopener";
    return a;
  }

  // ---------- sound + vibration (off by default) ----------
  var audioCtx = null;
  function feedback(kind) {
    if (!$("sound-on").checked) return;
    try {
      if (navigator.vibrate) navigator.vibrate(kind === "win" ? [30, 60, 30, 60, 80] : kind === "s" ? [15, 40, 15] : 12);
    } catch (e) { /* not supported */ }
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      var notes = { y: [660, 880], n: [330, 247], s: [784, 988, 1319], win: [523, 659, 784, 1047] }[kind] || [440];
      var t0 = audioCtx.currentTime;
      notes.forEach(function (f, i) {
        var o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.type = "triangle";
        o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t0 + i * 0.07);
        g.gain.exponentialRampToValueAtTime(0.12, t0 + i * 0.07 + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.07 + 0.16);
        o.connect(g); g.connect(audioCtx.destination);
        o.start(t0 + i * 0.07); o.stop(t0 + i * 0.07 + 0.18);
      });
    } catch (e) { /* no audio */ }
  }

  // ---------- confetti (one celebratory moment) ----------
  function confetti() {
    if (reduceMotion) return;
    var c = $("confetti"), ctx = c.getContext && c.getContext("2d");
    if (!ctx) return;
    var w = c.width = window.innerWidth, h = c.height = window.innerHeight;
    var colors = ["#ffcf4a", "#ff9fb4", "#7fd8cc", "#a6c8ff", "#ff9d5c", "#b2e57a"];
    var bits = [];
    for (var i = 0; i < 140; i++) {
      bits.push({
        x: w / 2 + (Math.random() - 0.5) * w * 0.3, y: h * 0.35,
        vx: (Math.random() - 0.5) * 12, vy: -Math.random() * 13 - 4,
        r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.4,
        s: 5 + Math.random() * 6, c: colors[i % colors.length]
      });
    }
    c.style.display = "block";
    var start = performance.now();
    (function frame(now) {
      var t = now - start;
      ctx.clearRect(0, 0, w, h);
      bits.forEach(function (b) {
        b.vy += 0.35; b.vx *= 0.99; b.x += b.vx; b.y += b.vy; b.r += b.vr;
        ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.r);
        ctx.fillStyle = b.c; ctx.globalAlpha = Math.max(0, 1 - t / 2600);
        ctx.fillRect(-b.s / 2, -b.s / 4, b.s, b.s / 2);
        ctx.restore();
      });
      if (t < 2600) requestAnimationFrame(frame);
      else { ctx.clearRect(0, 0, w, h); c.style.display = "none"; }
    })(start);
  }

  // =====================================================================
  // 1. SETUP
  // =====================================================================
  function renderPlayers(names) {
    var list = $("player-list");
    list.innerHTML = "";
    names.forEach(function (name, i) {
      var li = el("li", "player-row");
      var input = el("input");
      input.type = "text";
      input.maxLength = 16;
      input.autocomplete = "off";
      input.placeholder = "Person " + (i + 1);
      input.value = name;
      input.setAttribute("aria-label", "Person " + (i + 1));
      input.addEventListener("input", saveSettings);
      li.appendChild(input);
      if (names.length > L.MIN_PLAYERS) {
        var rm = el("button", "remove", "×");
        rm.type = "button";
        rm.setAttribute("aria-label", "Remove person " + (i + 1));
        rm.addEventListener("click", function () {
          var cur = readNames(false);
          cur.splice(i, 1);
          renderPlayers(cur);
          saveSettings();
        });
        li.appendChild(rm);
      }
      list.appendChild(li);
    });
    $("add-player").hidden = names.length >= L.MAX_PLAYERS;
  }

  function readNames(withDefaults) {
    var names = Array.prototype.map.call(document.querySelectorAll("#player-list input"), function (inp, i) {
      var v = inp.value.trim();
      return withDefaults ? (v || "Person " + (i + 1)) : v;
    });
    if (withDefaults) {
      // make duplicate names unique so results stay readable
      var count = {};
      names = names.map(function (n) {
        var k = n.toLowerCase();
        count[k] = (count[k] || 0) + 1;
        return count[k] > 1 ? n + " " + count[k] : n;
      });
    }
    return names;
  }

  function setMode(mode) {
    state.mode = mode;
    document.querySelectorAll("#mode button").forEach(function (b) {
      b.setAttribute("aria-pressed", b.dataset.mode === mode ? "true" : "false");
    });
    $("mode-hint").textContent = mode === "phone"
      ? "Take turns on this phone. The app hides each person's answers."
      : "You swipe first, then send a link to the next person. No app or account needed.";
    saveSettings();
  }

  function buildFilterControls() {
    // vibes (single choice)
    var vibes = $("vibe-chips");
    [{ id: "", label: "Anything" }].concat(L.VIBES).forEach(function (v) {
      var b = el("button", "chip", v.label);
      b.type = "button";
      b.dataset.vibe = v.id;
      b.addEventListener("click", function () {
        state.options.vibe = v.id;
        syncFilterControls();
        filtersChanged();
      });
      vibes.appendChild(b);
    });
    // genres (any of)
    var box = $("genre-chips");
    L.allGenres(MOVIES).forEach(function (g) {
      var b = el("button", "chip", g);
      b.type = "button";
      b.dataset.genre = g;
      b.style.setProperty("--chip", GENRE_COLORS[g] || "");
      b.addEventListener("click", function () {
        var i = state.options.genres.indexOf(g);
        if (i === -1) state.options.genres.push(g); else state.options.genres.splice(i, 1);
        syncFilterControls();
        filtersChanged();
      });
      box.appendChild(b);
    });
    // regions
    var region = $("region");
    [{ id: "", label: "Anywhere" }].concat(L.REGIONS).forEach(function (r) {
      var o = el("option", null, r.label);
      o.value = r.id;
      region.appendChild(o);
    });
    // decades
    var minYear = Math.min.apply(null, MOVIES.map(function (m) { return m.year; }));
    var from = $("from-year"), to = $("to-year");
    from.appendChild(new Option("Any year", "0"));
    to.appendChild(new Option("Today", "0"));
    for (var d = Math.floor(minYear / 10) * 10; d <= 2020; d += 10) {
      from.appendChild(new Option(d + "s", String(d)));
      to.appendChild(new Option(d + "s", String(d + 9)));
    }
    ["region", "max-runtime", "from-year", "to-year"].forEach(function (id) {
      $(id).addEventListener("change", function () {
        state.options.region = $("region").value;
        state.options.maxRuntime = Number($("max-runtime").value) || 0;
        state.options.fromYear = Number($("from-year").value) || 0;
        state.options.toYear = Number($("to-year").value) || 0;
        filtersChanged();
      });
    });
    $("hide-seen").addEventListener("change", function () {
      state.options.hideSeen = $("hide-seen").checked;
      filtersChanged();
    });
    $("reset-filters").addEventListener("click", function () {
      state.options = clone(DEFAULT_OPTIONS);
      syncFilterControls();
      filtersChanged();
    });
  }

  function syncFilterControls() {
    var o = state.options;
    document.querySelectorAll("#vibe-chips .chip").forEach(function (b) {
      b.setAttribute("aria-pressed", b.dataset.vibe === (o.vibe || "") ? "true" : "false");
    });
    document.querySelectorAll("#genre-chips .chip").forEach(function (b) {
      b.setAttribute("aria-pressed", o.genres.indexOf(b.dataset.genre) !== -1 ? "true" : "false");
    });
    $("region").value = o.region || "";
    $("max-runtime").value = String(o.maxRuntime || 0);
    $("from-year").value = String(o.fromYear || 0);
    $("to-year").value = String(o.toYear || 0);
    $("hide-seen").checked = o.hideSeen !== false;
    var nSeen = Object.keys(seen).length;
    $("seen-count").textContent = nSeen ? "(" + nSeen + " marked)" : "";
    $("clear-seen").hidden = nSeen === 0;
  }

  function currentFilter(extraExclude) {
    var o = state.options;
    var exclude = {};
    if (o.hideSeen !== false) for (var k in seen) exclude[k] = true;
    if (extraExclude) for (var j in extraExclude) exclude[j] = true;
    return {
      genres: o.genres, vibe: o.vibe, region: o.region, fromYear: o.fromYear,
      toYear: o.toYear, maxRuntime: o.maxRuntime, exclude: exclude
    };
  }

  function filtersChanged() {
    var n = L.filterMovies(MOVIES, currentFilter()).length;
    var p = $("pool-count");
    var start = $("start-btn");
    if (n === 0) {
      p.textContent = "No movies fit these filters. Remove a genre, pick another vibe, or reset filters.";
      p.classList.add("pool-empty");
      start.disabled = true;
    } else {
      var size = Math.min(n, state.deckSize);
      p.textContent = n + " of " + MOVIES.length + " movies fit. Each person swipes " + size + ".";
      p.classList.remove("pool-empty");
      start.disabled = false;
    }
    // little summary next to "More filters" so active filters are never hidden
    var o = state.options, bits = [];
    if (o.genres.length) bits.push(o.genres.length === 1 ? o.genres[0] : o.genres.length + " genres");
    if (o.region) bits.push($("region").selectedOptions[0].textContent);
    if (o.maxRuntime) bits.push($("max-runtime").selectedOptions[0].textContent.toLowerCase());
    if (o.fromYear || o.toYear) bits.push((o.fromYear || "…") + "–" + (o.toYear || "now"));
    $("more-summary").textContent = bits.length ? "(" + bits.join(", ") + ")" : "";
    saveSettings();
  }

  function setDeckSize(size) {
    state.deckSize = size;
    document.querySelectorAll("#deck-size button").forEach(function (b) {
      b.setAttribute("aria-pressed", Number(b.dataset.size) === size ? "true" : "false");
    });
    filtersChanged();
  }

  var restoring = false;
  function saveSettings() {
    if (restoring) return;
    save(KEYS.settings, { names: readNames(false), mode: state.mode, options: state.options, deckSize: state.deckSize });
  }
  function restoreSettings() {
    restoring = true;
    var s = load(KEYS.settings, null) || {};
    var names = Array.isArray(s.names) && s.names.length >= 2 ? s.names.slice(0, L.MAX_PLAYERS) : ["", ""];
    renderPlayers(names);
    if (s.options) {
      var o = s.options;
      state.options = {
        genres: Array.isArray(o.genres) ? o.genres : [], vibe: o.vibe || "", region: o.region || "",
        fromYear: o.fromYear || 0, toYear: o.toYear || 0, maxRuntime: o.maxRuntime || 0, hideSeen: o.hideSeen !== false
      };
    }
    restoring = false;
    syncFilterControls();
    setMode(s.mode === "link" ? "link" : "phone");
    setDeckSize([10, 20, 30, 50].indexOf(s.deckSize) !== -1 ? s.deckSize : 20);
  }

  function startGame() {
    state.names = readNames(true);
    state.joined = false;
    state.recent = {};
    saveSettings();
    newRound();
  }

  function newRound() {
    // Prefer movies not shown yet this sitting; fall back if that leaves too few.
    var fresh = L.filterMovies(MOVIES, currentFilter(state.recent));
    var deck = fresh.length >= state.deckSize ? L.buildDeck(MOVIES, currentFilter(state.recent), state.deckSize)
      : L.buildDeck(MOVIES, currentFilter(), state.deckSize);
    if (deck.length === 0) { show("screen-setup"); filtersChanged(); return; }
    state.deck = deck;
    deck.forEach(function (m) { state.recent[m.id] = true; });
    state.votes = state.names.map(function () { return {}; });
    state.player = 0;
    state.results = null;
    state.winner = null;
    startTurn();
  }

  // =====================================================================
  // 2. JOINING FROM A LINK
  // =====================================================================
  function sessionFromState() {
    return {
      players: state.names,
      deck: state.deck.map(function (m) { return m.id; }),
      votes: state.votes.slice(0, state.player + 1),
      limit: SUPER_LIMIT
    };
  }
  function linkFor(session) {
    return location.href.split("#")[0] + "#s=" + L.encodeSession(session);
  }

  function openFromHash() {
    var m = location.hash.match(/^#s=([A-Za-z0-9_-]+)/);
    if (!m) return false;
    var s = L.decodeSession(m[1], MOVIES);
    if (!s) {
      toast("That movie night link is broken. Start a new one here.");
      return false;
    }
    state.mode = "link";
    state.joined = true;
    state.names = s.players;
    state.deck = s.deck.map(function (id) { return BY_ID[id]; });
    state.votes = s.players.map(function (_, i) { return s.votes[i] || {}; });
    var done = s.votes.length;

    if (done >= s.players.length) {
      state.player = s.players.length - 1;
      showResults();
      return true;
    }
    state.player = done;
    $("invite-from").textContent = s.players[0] + " started a movie night";
    $("invite-title").textContent = "Your turn, " + s.players[done];
    renderProgressPlayers($("invite-players"), done);
    $("invite-text").textContent = "Swipe through " + s.deck.length + " movies. Your answers stay hidden until everyone is done.";
    $("invite-start").textContent = "I'm " + s.players[done] + ", start swiping";
    show("screen-invite");
    return true;
  }

  function renderProgressPlayers(list, current) {
    list.innerHTML = "";
    state.names.forEach(function (n, i) {
      var li = el("li", i < current ? "is-done" : i === current ? "is-now" : "", n);
      if (i < current) li.setAttribute("aria-label", n + ", done");
      if (i === current) li.setAttribute("aria-current", "step");
      list.appendChild(li);
    });
  }

  // =====================================================================
  // 3. SWIPING
  // =====================================================================
  function startTurn() {
    state.order = L.shuffle(state.deck);
    state.index = 0;
    state.undo = [];
    state.busy = false;
    $("turn-name").textContent = state.names[state.player];
    show("screen-swipe");
    renderStack();
  }

  function myVotes() { return state.votes[state.player]; }

  function renderTicket(movie) {
    var t = el("article", "ticket");
    t.style.setProperty("--tk", colorFor(movie));
    t.dataset.id = movie.id;

    var inner = el("div", "ticket-inner");
    // ---- front
    var front = el("div", "face face-front");
    var yr = el("span", "ticket-year", String(movie.year));
    yr.setAttribute("aria-hidden", "true");
    front.appendChild(yr);
    var main = el("div", "ticket-main");
    main.appendChild(el("p", "ticket-genres", movie.genres.join(", ")));
    main.appendChild(el("h2", "ticket-title" + (movie.title.length > 26 ? " is-long" : "") + (movie.title.length > 48 ? " is-longer" : ""), movie.title));
    main.appendChild(el("p", "ticket-pitch", movie.pitch));
    front.appendChild(main);
    var stub = el("div", "ticket-stub");
    [["Year", movie.year], ["Length", formatRuntime(movie.runtime)], ["Made in", countryName(movie.country)]].forEach(function (pair) {
      var s = el("span");
      s.appendChild(el("small", null, pair[0]));
      s.appendChild(document.createTextNode(pair[1]));
      stub.appendChild(s);
    });
    front.appendChild(stub);
    var info = el("button", "info-btn", "i");
    info.type = "button";
    info.setAttribute("aria-label", "Details for " + movie.title);
    front.appendChild(info);
    inner.appendChild(front);

    // ---- back
    var back = el("div", "face face-back");
    back.setAttribute("aria-hidden", "true");
    back.appendChild(el("h3", "back-title", movie.title + " (" + movie.year + ")"));
    var dl = el("dl", "back-facts");
    [["Directed by", movie.director], ["Starring", movie.cast.length ? movie.cast.join(", ") : "No credited cast"],
      ["Made in", countryName(movie.country)], ["Genres", movie.genres.join(", ")], ["Length", formatRuntime(movie.runtime)]]
      .forEach(function (row) { dl.appendChild(el("dt", null, row[0])); dl.appendChild(el("dd", null, row[1])); });
    back.appendChild(dl);
    var links = el("div", "back-links");
    links.appendChild(externalLink("Watch trailer", trailerUrl(movie)));
    links.appendChild(externalLink("Where to stream", streamUrl(movie)));
    back.appendChild(links);
    var seenBtn = el("button", "seen-btn", "Seen it: skip and hide in future stacks");
    seenBtn.type = "button";
    back.appendChild(seenBtn);
    back.appendChild(el("p", "back-hint", "Tap the card to flip back"));
    inner.appendChild(back);
    t.appendChild(inner);

    t.appendChild(el("span", "stamp stamp-yes", "Yes"));
    t.appendChild(el("span", "stamp stamp-no", "Skip"));
    t.appendChild(el("span", "stamp stamp-super", "Must watch"));
    return t;
  }

  function flip(card, force) {
    var on = force != null ? force : !card.classList.contains("is-flipped");
    card.classList.toggle("is-flipped", on);
    card.querySelector(".face-back").setAttribute("aria-hidden", on ? "false" : "true");
    card.querySelector(".face-front").setAttribute("aria-hidden", on ? "true" : "false");
  }

  function renderStack() {
    var stack = $("stack");
    stack.innerHTML = "";
    var total = state.order.length;
    $("turn-count").textContent = Math.min(state.index + 1, total) + " of " + total;
    $("progress-bar").style.width = (state.index / total * 100) + "%";
    $("undo-btn").disabled = state.undo.length === 0;
    var left = L.superLeft(myVotes(), SUPER_LIMIT);
    $("super-left").textContent = "(" + left + " left)";
    $("super-btn").classList.toggle("is-empty", left === 0);
    $("super-btn").setAttribute("aria-label", "Must watch, " + left + " left");

    var next = state.order[state.index + 1];
    if (next) {
      var n = renderTicket(next);
      n.classList.add("is-next");
      n.setAttribute("aria-hidden", "true");
      n.inert = true;
      stack.appendChild(n);
    }
    var top = state.order[state.index];
    if (top) {
      var t = renderTicket(top);
      stack.appendChild(t);
      attachCard(t, top);
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

  function attachCard(card, movie) {
    var startX = 0, startY = 0, dx = 0, dy = 0, dragging = false, pointerId = null, startT = 0;

    card.querySelector(".info-btn").addEventListener("click", function (e) { e.stopPropagation(); flip(card); });
    card.querySelector(".seen-btn").addEventListener("click", function (e) {
      e.stopPropagation();
      seen[movie.id] = true;
      save(KEYS.seen, seen);
      toast(movie.title + " won't show up again");
      answer("n");
    });

    card.addEventListener("pointerdown", function (e) {
      if (state.busy || (e.pointerType === "mouse" && e.button !== 0)) return;
      if (e.target.closest("a, button")) return; // let links and buttons work
      dragging = true;
      pointerId = e.pointerId;
      startX = e.clientX; startY = e.clientY; dx = 0; dy = 0; startT = Date.now();
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
      var moved = Math.abs(dx) + Math.abs(dy);
      if (moved < 8 && Date.now() - startT < 400 && e.type === "pointerup") {
        card.style.transform = "";
        flip(card);
        return;
      }
      var vote = null;
      if (-dy > SWIPE_DISTANCE && Math.abs(dy) > Math.abs(dx)) vote = "s";
      else if (dx > SWIPE_DISTANCE) vote = "y";
      else if (dx < -SWIPE_DISTANCE) vote = "n";

      if (vote === "s" && L.superLeft(myVotes(), SUPER_LIMIT) === 0) {
        toast("No must-watch picks left. Swipe right for yes.");
        vote = null;
      }
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
    var movie = state.order[state.index];
    if (!movie) return;
    if (vote === "s" && L.superLeft(myVotes(), SUPER_LIMIT) === 0) {
      toast("No must-watch picks left. Swipe right for yes.");
      return;
    }
    state.busy = true;
    myVotes()[movie.id] = vote;
    state.undo.push(movie.id);
    feedback(vote);

    var card = $("stack").querySelector(".ticket:not(.is-next)");
    var finish = function () {
      state.index++;
      state.busy = false;
      if (state.index >= state.order.length) {
        $("stack").innerHTML = "";
        $("progress-bar").style.width = "100%";
        endTurn();
      } else {
        renderStack();
      }
    };
    if (!card || reduceMotion) { finish(); return; }

    var w = window.innerWidth;
    var x = vote === "y" ? w : vote === "n" ? -w : (from ? from.dx : 0);
    var y = vote === "s" ? -window.innerHeight : (from ? from.dy : 0);
    setStamps(card, vote === "y" ? 200 : vote === "n" ? -200 : 0, vote === "s" ? -200 : 0);
    card.classList.add("is-flying");
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
    delete myVotes()[id];
    state.index = Math.max(0, state.index - 1);
    renderStack();
  }

  function endTurn() {
    var last = state.player >= state.names.length - 1;
    if (last) { showResults(); return; }
    var next = state.names[state.player + 1];
    if (state.mode === "link") {
      var url = linkFor(sessionFromState());
      $("send-to").textContent = next;
      renderProgressPlayers($("send-players"), state.player + 1);
      $("link-box").value = url;
      $("here-btn").textContent = next + " is here: swipe on this phone instead";
      $("share-btn").hidden = !navigator.share;
      show("screen-send");
    } else {
      $("handoff-from").textContent = state.names[state.player];
      $("handoff-to").textContent = next;
      renderProgressPlayers($("handoff-players"), state.player + 1);
      $("handoff-btn").textContent = "I'm " + next + ", start";
      show("screen-handoff");
      $("handoff-btn").focus();
    }
  }

  function nextPlayer() {
    state.player++;
    startTurn();
  }

  // ---------- sharing ----------
  function copyText(text, okMsg) {
    var ok = function () { toast(okMsg); };
    var fallback = function () {
      var ta = el("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); ok(); } catch (e) { toast("Couldn't copy. Select the text and copy it yourself."); }
      document.body.removeChild(ta);
    };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(ok, fallback);
    else fallback();
  }
  function shareOrCopy(title, text, url, okMsg) {
    if (navigator.share) {
      navigator.share({ title: title, text: text, url: url }).catch(function (e) {
        if (e && e.name !== "AbortError") copyText(text + "\n" + url, okMsg);
      });
    } else {
      copyText(text + "\n" + url, okMsg);
    }
  }

  // =====================================================================
  // 5. RESULTS
  // =====================================================================
  function resultRow(item, badge) {
    var m = item.movie;
    var li = el("li");
    li.style.setProperty("--tk", colorFor(m));
    li.dataset.id = m.id;
    var info = el("span");
    info.appendChild(el("span", "r-title", m.title));
    info.appendChild(el("span", "r-meta", m.year + ", " + formatRuntime(m.runtime) + ", " + m.genres.slice(0, 2).join(", ")));
    li.appendChild(info);
    li.appendChild(el("span", "r-badge", badge));
    return li;
  }

  function matchBadge(item) {
    var n = state.names.length;
    if (item.perfect) return n === 2 ? "Both: must watch" : "Everyone: must watch";
    if (item.supers.length) return "★ ×" + item.supers.length;
    return n === 2 ? "Both: yes" : "All yes";
  }
  function almostBadge(item) {
    if (state.names.length === 2) return "Only " + state.names[item.yes[0]];
    var missing = state.names.filter(function (_, i) { return item.yes.indexOf(i) === -1; });
    return "Not " + missing.join(", ");
  }

  function showResults() {
    var n = state.names.length;
    var r = L.computeResults(state.deck, state.votes);
    state.results = r;
    state.winner = null;
    state.pool = r.matches.length ? r.matches : r.almost;

    var m = r.matches.length;
    var who = n === 2 ? "You" : "All " + n + " of you";
    $("results-title").textContent = m === 0 ? "No perfect match" : who + " matched on " + m + (m === 1 ? " movie" : " movies");
    if (m === 0 && r.almost.length) {
      $("results-lead").textContent = n === 2
        ? "Nothing got a yes from both of you, but one of you liked these. Draw from them, or try a new stack."
        : "Nothing got a yes from everyone, but these were close. Draw from them, or try a new stack.";
    } else if (m === 0) {
      $("results-lead").textContent = "Tough crowd. Try a new stack or a different vibe.";
    } else if (m === 1) {
      $("results-lead").textContent = "Easy choice. Draw it to make it official.";
    } else {
      $("results-lead").textContent = "Draw a movie (must-watch picks give it more tickets), or settle it with a head-to-head showdown.";
    }

    $("matches-heading").textContent = n === 2 ? "You both said yes" : "Everyone said yes";
    var ml = $("matches-list");
    ml.innerHTML = "";
    r.matches.forEach(function (it) { ml.appendChild(resultRow(it, matchBadge(it))); });
    $("matches-block").hidden = m === 0;

    $("almost-heading").textContent = n === 2 ? "Only one of you said yes" : "All but one said yes";
    var al = $("almost-list");
    al.innerHTML = "";
    r.almost.slice(0, 12).forEach(function (it) { al.appendChild(resultRow(it, almostBadge(it))); });
    $("almost-block").hidden = r.almost.length === 0;

    var facts = L.funFacts(state.names, state.deck, state.votes);
    var dl = $("facts-list");
    dl.innerHTML = "";
    facts.forEach(function (f) { var d = el("div"); d.appendChild(el("dt", null, f.label)); d.appendChild(el("dd", null, f.text)); dl.appendChild(d); });
    $("facts-block").hidden = facts.length === 0;

    $("admit").hidden = true;
    var canPick = state.pool.length > 0;
    $("draw-btn").hidden = !canPick;
    $("draw-btn").disabled = false;
    $("draw-btn").textContent = "Draw tonight's movie";
    $("showdown-btn").hidden = state.pool.length < 3;
    $("draw-hint").textContent = state.pool.length > 8 ? "The showdown uses your top 8." : "";
    $("rematch-btn").textContent = state.joined ? "Plan your own movie night" : "New stack, same people";

    show("screen-results");
    addHistory();
    if (m > 0) feedback("win");
  }

  function landWinner(item) {
    var admit = $("admit");
    state.winner = item;
    admit.classList.remove("is-spinning");
    $("admit-who").textContent = state.names.join(" & ").replace(/ & (?=.* & )/g, ", ") + (state.names.length === 2 ? " are" : " are all") + " watching";
    $("admit-title").textContent = item.movie.title;
    $("admit-meta").textContent = item.movie.year + ", " + formatRuntime(item.movie.runtime) + ", directed by " + item.movie.director;
    var links = $("admit-links");
    links.innerHTML = "";
    links.appendChild(externalLink("Watch trailer", trailerUrl(item.movie)));
    links.appendChild(externalLink("Where to stream", streamUrl(item.movie)));
    var watched = el("button", "chip-link chip-button", "We watched it");
    watched.type = "button";
    watched.addEventListener("click", function () {
      seen[item.movie.id] = true;
      save(KEYS.seen, seen);
      watched.disabled = true;
      watched.textContent = "Marked as seen";
      syncFilterControls();
    });
    links.appendChild(watched);
    admit.hidden = false;
    void admit.offsetWidth;
    admit.classList.add("is-landed");
    $("draw-btn").disabled = false;
    $("draw-btn").textContent = "Draw again";
    document.querySelectorAll("#matches-list li, #almost-list li").forEach(function (li) {
      li.classList.toggle("is-winner", li.dataset.id === item.movie.id);
    });
    updateLastHistory(item.movie.title);
    feedback("win");
    confetti();
  }

  function draw() {
    var pool = state.pool;
    if (!pool.length) return;
    var winner = L.pickWinner(pool);
    var admit = $("admit");
    admit.hidden = false;
    admit.classList.remove("is-landed");
    $("admit-links").innerHTML = "";
    $("draw-btn").disabled = true;

    if (reduceMotion || pool.length === 1) { landWinner(winner); return; }
    admit.classList.add("is-spinning");
    $("admit-who").textContent = "Drawing…";
    $("admit-meta").textContent = "";
    var steps = 16, i = 0, k = Math.floor(Math.random() * pool.length);
    (function tick() {
      $("admit-title").textContent = pool[(k + i) % pool.length].movie.title;
      i++;
      if (i >= steps) { landWinner(winner); return; }
      setTimeout(tick, 50 + i * i * 1.6);
    })();
  }

  // =====================================================================
  // 6. SHOWDOWN
  // =====================================================================
  function startShowdown() {
    state.showdown = L.createShowdown(state.pool);
    renderDuel();
    show("screen-showdown");
  }

  function renderDuel() {
    var s = state.showdown;
    var w = L.showdownWinner(s);
    if (w) {
      show("screen-results");
      landWinner(w);
      $("admit").scrollIntoView({ block: "center", behavior: reduceMotion ? "auto" : "smooth" });
      return;
    }
    var pair = L.showdownPair(s);
    $("sd-round").textContent = s.round;
    var left = L.showdownMatchesLeft(s);
    $("sd-left").textContent = left === 1 ? "Final!" : left + " picks left";
    var duel = $("duel");
    duel.innerHTML = "";
    pair.forEach(function (item, i) {
      var m = item.movie;
      var b = el("button", "duel-card");
      b.type = "button";
      b.style.setProperty("--tk", colorFor(m));
      b.appendChild(el("span", "duel-genres", m.genres.join(", ")));
      b.appendChild(el("span", "duel-title", m.title));
      b.appendChild(el("span", "duel-pitch", m.pitch));
      b.appendChild(el("span", "duel-meta", m.year + ", " + formatRuntime(m.runtime)));
      b.addEventListener("click", function () {
        feedback("y");
        state.showdown = L.showdownChoose(state.showdown, i);
        renderDuel();
      });
      duel.appendChild(b);
      if (i === 0) duel.appendChild(el("span", "versus", "or"));
    });
  }

  // ---------- history ----------
  function addHistory() {
    var list = load(KEYS.history, []);
    list.unshift({ date: new Date().toISOString(), names: state.names.slice(), matches: state.results.matches.length, winner: null });
    save(KEYS.history, list.slice(0, 10));
    renderHistory();
  }
  function updateLastHistory(title) {
    var list = load(KEYS.history, []);
    if (list.length) { list[0].winner = title; save(KEYS.history, list); }
    renderHistory();
  }
  function renderHistory() {
    var list = load(KEYS.history, []);
    var ol = $("history-list");
    ol.innerHTML = "";
    $("history").hidden = list.length === 0;
    list.forEach(function (h) {
      var li = el("li");
      var when = new Date(h.date).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
      li.appendChild(document.createTextNode(when + ": " + h.names.join(", ") + ", "));
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
    buildFilterControls();
    restoreSettings();
    renderHistory();
    try { $("sound-on").checked = load("mnm.sound", false) === true; } catch (e) { /* ignore */ }
    $("sound-on").addEventListener("change", function () { save("mnm.sound", $("sound-on").checked); if ($("sound-on").checked) feedback("y"); });

    $("setup-form").addEventListener("submit", function (e) { e.preventDefault(); startGame(); });
    $("add-player").addEventListener("click", function () {
      var cur = readNames(false);
      if (cur.length >= L.MAX_PLAYERS) return;
      cur.push("");
      renderPlayers(cur);
      saveSettings();
      var inputs = document.querySelectorAll("#player-list input");
      inputs[inputs.length - 1].focus();
    });
    document.querySelectorAll("#mode button").forEach(function (b) {
      b.addEventListener("click", function () { setMode(b.dataset.mode); });
    });
    document.querySelectorAll("#deck-size button").forEach(function (b) {
      b.addEventListener("click", function () { setDeckSize(Number(b.dataset.size)); });
    });
    $("clear-history").addEventListener("click", function () { save(KEYS.history, []); renderHistory(); toast("History cleared"); });
    $("clear-seen").addEventListener("click", function () {
      seen = {}; save(KEYS.seen, seen); syncFilterControls(); filtersChanged(); toast("Seen list cleared");
    });

    $("invite-start").addEventListener("click", startTurn);

    document.querySelectorAll(".actions [data-vote]").forEach(function (b) {
      b.addEventListener("click", function () { answer(b.dataset.vote); });
    });
    $("undo-btn").addEventListener("click", undoLast);
    $("handoff-btn").addEventListener("click", nextPlayer);
    $("here-btn").addEventListener("click", nextPlayer);
    $("share-btn").addEventListener("click", function () {
      shareOrCopy("Movie night", "Your turn to pick movies, " + state.names[state.player + 1] + "!", $("link-box").value, "Link copied");
    });
    $("copy-link-btn").addEventListener("click", function () { copyText($("link-box").value, "Link copied. Paste it in a chat."); });
    $("link-box").addEventListener("focus", function () { this.select(); });

    $("draw-btn").addEventListener("click", draw);
    $("showdown-btn").addEventListener("click", startShowdown);
    $("sd-cancel").addEventListener("click", function () { show("screen-results"); });
    $("share-results-btn").addEventListener("click", function () {
      var url = linkFor({ players: state.names, deck: state.deck.map(function (m) { return m.id; }), votes: state.votes, limit: SUPER_LIMIT });
      shareOrCopy("Movie night results", L.resultsToText(state.names, state.results, state.winner), url, "Results copied");
    });
    $("rematch-btn").addEventListener("click", function () {
      if (state.joined) {
        history.replaceState(null, "", location.pathname + location.search);
        state.joined = false;
        renderPlayers(state.names.slice());
        filtersChanged();
        show("screen-setup");
      } else {
        newRound();
      }
    });
    $("settings-btn").addEventListener("click", function () {
      if (state.joined) history.replaceState(null, "", location.pathname + location.search);
      state.joined = false;
      syncFilterControls();
      filtersChanged();
      show("screen-setup");
    });

    document.addEventListener("keydown", function (e) {
      if (!$("screen-swipe").hasAttribute("data-active")) return;
      if (e.target.closest && e.target.closest("input, select, textarea")) return;
      var map = { ArrowRight: "y", ArrowLeft: "n", ArrowUp: "s" };
      if (map[e.key]) { e.preventDefault(); answer(map[e.key]); }
      else if (e.key === "Backspace" || (e.key === "z" && (e.ctrlKey || e.metaKey))) { e.preventDefault(); undoLast(); }
      else if (e.key === "i" || e.key === "I") {
        var card = $("stack").querySelector(".ticket:not(.is-next)");
        if (card) flip(card);
      }
    });

    window.addEventListener("hashchange", function () { if (/^#s=/.test(location.hash)) openFromHash(); });
    openFromHash();

    // Offline support + "Add to home screen" (only works over http/https, not file://)
    if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
      navigator.serviceWorker.register("sw.js").catch(function () { /* offline mode is optional */ });
    }
  }

  init();
})();
