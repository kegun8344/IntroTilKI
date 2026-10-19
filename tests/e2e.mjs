// End-to-end tests: plays real movie nights in a phone-sized Chromium.
// Setup once:  npm install  &&  npx playwright install chromium
// Run:         npm run test:e2e          (starts its own local web server)
//   Screenshots are saved to ./screenshots
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)), ".."));
const shots = path.resolve(process.argv[3] || "screenshots");
fs.mkdirSync(shots, { recursive: true });

// ---------- tiny static server (service workers need http, not file://) ----------
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2" };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p.endsWith("/")) p += "index.html";
  const file = path.join(root, p);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end("not found"); }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${server.address().port}/`;

// ---------- test helpers ----------
let failures = 0, passes = 0;
const check = (cond, msg) => { if (cond) passes++; else failures++; console.log((cond ? "  PASS " : "  FAIL ") + msg); };
const section = name => console.log("\n" + name);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const errors = [];
async function newPhone() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: false });
  const page = await ctx.newPage();
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  return { ctx, page };
}

let maxOverflow = 0;
const sampleOverflow = async page => {
  const extra = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  maxOverflow = Math.max(maxOverflow, extra);
};
const topCard = page => page.$("#stack .ticket:not(.is-next)");
const topMovie = page => page.$eval("#stack .ticket:not(.is-next)", n => {
  const m = window.MOVIES.find(x => x.id === n.dataset.id);
  return { id: m.id, title: m.title };
});

async function vote(page, kind, how) {
  if (how === "drag") {
    const box = await (await topCard(page)).boundingBox();
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    const dx = kind === "y" ? 180 : kind === "n" ? -180 : 0, dy = kind === "s" ? -200 : 0;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    for (let s = 1; s <= 8; s++) await page.mouse.move(cx + dx * s / 8, cy + dy * s / 8);
    await sampleOverflow(page);
    await page.mouse.up();
  } else if (how === "key") {
    await page.keyboard.press({ y: "ArrowRight", n: "ArrowLeft", s: "ArrowUp" }[kind]);
  } else {
    await page.click(`.actions [data-vote="${kind}"]`);
  }
  for (let t = 0; t < 4; t++) { await page.waitForTimeout(60); await sampleOverflow(page); }
  await page.waitForTimeout(200);
}

// Plays one person's turn. rule(movie, i) -> "y" | "n" | "s". Returns { id: vote }.
async function playTurn(page, name, rule, extras = {}) {
  check((await page.textContent("#turn-name")) === name, `${name}'s turn is shown`);
  const total = Number((await page.textContent("#turn-count")).split(" of ")[1]);
  const votes = {};
  let i = 0;
  while ((await topCard(page)) && i < 60) {
    const m = await topMovie(page);
    if (extras.onCard) {
      const override = await extras.onCard(page, m, i);
      if (override) { votes[m.id] = override; i++; continue; }
    }
    const k = rule(m, i);
    await vote(page, k, ["drag", "button", "key"][i % 3]);
    votes[m.id] = k;
    i++;
  }
  check(i === total, `${name} answered all ${total} cards`);
  return votes;
}

function expected(deckIds, votesList) {
  const yes = (v, id) => v[id] === "y" || v[id] === "s";
  const n = votesList.length;
  const matches = deckIds.filter(id => votesList.every(v => yes(v, id)));
  const almost = deckIds.filter(id => {
    const c = votesList.filter(v => yes(v, id)).length;
    return c < n && c > 0 && c >= n - 1;
  });
  return { matches, almost };
}
const listIds = (page, sel) => page.$$eval(sel + " li", lis => lis.map(l => l.dataset.id));
const sameSet = (a, b) => a.length === b.length && a.every(x => b.includes(x));

try {
  // =====================================================================
  section("1. Setup screen and filters");
  const { page } = await newPhone();
  await page.goto(BASE);
  check(/570 of 570 movies fit/.test(await page.textContent("#pool-count")), "all 570 movies available with no filters");
  await page.screenshot({ path: path.join(shots, "1-setup.png"), fullPage: true });

  await page.click('#vibe-chips [data-vibe="scary"]');
  const scary = Number((await page.textContent("#pool-count")).split(" ")[0]);
  check(scary > 20 && scary < 120, `"Scary" vibe narrows the pool (${scary})`);
  await page.click("#more-filters summary");
  await page.selectOption("#region", "no");
  const scaryNo = Number((await page.textContent("#pool-count")).split(" ")[0]);
  check(scaryNo > 0 && scaryNo < scary, `Scary + Norway narrows further (${scaryNo})`);
  check(/Norway/.test(await page.textContent("#more-summary")), "active filters summarised next to 'More filters'");
  await page.click('#genre-chips [data-genre="Western"]');
  check(await page.isDisabled("#start-btn"), "start is disabled when nothing fits");
  check(/No movies fit/.test(await page.textContent("#pool-count")), "explains how to fix an empty pool");
  await page.click("#reset-filters");
  await page.click('#vibe-chips [data-vibe=""]');
  check(/570 of 570/.test(await page.textContent("#pool-count")), "reset brings back all movies");

  for (let i = 0; i < 6; i++) if (await page.isVisible("#add-player")) await page.click("#add-player");
  check((await page.$$("#player-list li")).length === 6, "can add up to 6 people");
  check(!(await page.isVisible("#add-player")), "'Add a person' disappears at 6");
  await page.click("#player-list li:nth-child(6) .remove");
  await page.click("#player-list li:nth-child(5) .remove");
  await page.click("#player-list li:nth-child(4) .remove");
  check((await page.$$("#player-list li")).length === 3, "can remove people again");

  // =====================================================================
  section("2. Three people on one phone");
  const names = ["Kevin", "Sara", "Ola"];
  for (let i = 0; i < 3; i++) await page.fill(`#player-list li:nth-child(${i + 1}) input`, names[i]);
  await page.click('#deck-size [data-size="10"]');
  await page.click("#start-btn");
  await page.screenshot({ path: path.join(shots, "2-swipe.png") });

  // flip by tapping the card and with the info button
  let card = await topCard(page);
  const box = await card.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(550);
  check(await page.$eval("#stack .ticket:not(.is-next)", n => n.classList.contains("is-flipped")), "tapping a ticket flips it");
  check(await page.$eval("#stack .ticket:not(.is-next) .face-back", n => n.getAttribute("aria-hidden") === "false"), "back side is exposed to screen readers when flipped");
  const trailer = await page.$eval("#stack .ticket:not(.is-next) .back-links a", a => a.href);
  check(/youtube\.com\/results\?search_query=/.test(trailer), "trailer link points to a YouTube search");
  await page.screenshot({ path: path.join(shots, "3-ticket-back.png") });
  await page.keyboard.press("i");
  await page.waitForTimeout(550);
  check(await page.$eval("#stack .ticket:not(.is-next)", n => !n.classList.contains("is-flipped")), "the I key flips it back");

  let seenTitle = null, triedFourthSuper = false;
  const ruleA = (m, i) => (i < 3 ? "s" : m.title.length % 4 === 0 ? "n" : "y");
  const votesA = await playTurn(page, "Kevin", ruleA, {
    onCard: async (pg, m, i) => {
      if (i === 1) { // undo test
        await vote(pg, "n", "button");
        await pg.click("#undo-btn");
        await pg.waitForTimeout(120);
        check((await topMovie(pg)).id === m.id, "undo brings the same card back");
      }
      if (i === 3 && !triedFourthSuper) { // must-watch limit
        triedFourthSuper = true;
        check(/0 left/.test(await pg.textContent("#super-left")), "must-watch counter reaches 0 after 3");
        await pg.keyboard.press("ArrowUp");
        await pg.waitForTimeout(300);
        check((await topMovie(pg)).id === m.id, "a 4th must-watch is refused");
        check(/No must-watch picks left/.test(await pg.textContent("#toast")), "and the app says why");
      }
      if (i === 4) { // "seen it" from the back of the card
        await pg.click("#stack .ticket:not(.is-next) .info-btn");
        await pg.waitForTimeout(500);
        await pg.click("#stack .ticket:not(.is-next) .seen-btn");
        await pg.waitForTimeout(500);
        seenTitle = m.title;
        return "n";
      }
      return null;
    }
  });
  check(await page.isVisible("#screen-handoff"), "hand-off screen after the first person");
  check((await page.textContent("#handoff-to")) === "Sara", "asks to pass the phone to Sara");
  check(await page.$eval("#handoff-players li.is-done", li => li.textContent) === "Kevin", "progress shows Kevin as done");
  await page.screenshot({ path: path.join(shots, "4-handoff.png") });
  await page.click("#handoff-btn");
  const votesB = await playTurn(page, "Sara", m => (m.title.length % 5 === 0 ? "n" : "y"));
  await page.click("#handoff-btn");
  const votesC = await playTurn(page, "Ola", m => (m.title.length % 7 === 0 ? "n" : "y"));

  check(await page.isVisible("#screen-results"), "results after the last person");
  const deckIds = Object.keys(votesA);
  check(sameSet(deckIds, Object.keys(votesB)) && sameSet(deckIds, Object.keys(votesC)), "all three saw exactly the same movies");
  const exp = expected(deckIds, [votesA, votesB, votesC]);
  check(sameSet(await listIds(page, "#matches-list"), exp.matches), `"Everyone said yes" is correct (${exp.matches.length})`);
  check(sameSet(await listIds(page, "#almost-list"), exp.almost.slice(0, 12)), `"All but one" is correct (${exp.almost.length})`);
  check((await page.$$("#facts-list > div")).length >= 2, "fun facts are shown");
  await page.screenshot({ path: path.join(shots, "5-results.png"), fullPage: true });

  if (exp.matches.length) {
    await page.click("#draw-btn");
    await page.waitForTimeout(3000);
    const winner = await page.textContent("#admit-title");
    const titles = await page.$$eval("#matches-list .r-title", n => n.map(x => x.textContent));
    check(titles.includes(winner), "drawn winner is one of the matches: " + winner);
    check(await page.$("#matches-list li.is-winner") !== null, "winner highlighted in the list");
    const badges = await page.$$eval("#matches-list .r-badge", n => n.map(x => x.textContent));
    check(badges.some(b => /Kevin's must watch|★ Kevin/.test(b)) || !badges.some(b => b.startsWith("★")), "must-watch badges name who picked it");
  }
  if (exp.matches.length >= 3) {
    await page.click("#showdown-btn");
    check(await page.isVisible("#screen-showdown"), "showdown starts");
    check(await page.$eval("#confetti", c => getComputedStyle(c).display === "none"), "confetti from the draw stops when the showdown opens");
    await page.screenshot({ path: path.join(shots, "6-showdown.png") });
    let picks = 0;
    const expectedPicks = Math.min(exp.matches.length, 8) - 1;
    while (await page.isVisible("#screen-showdown") && picks < 10) {
      await page.click(".duel-card >> nth=" + (picks % 2));
      picks++;
      await page.waitForTimeout(80);
    }
    check(picks === expectedPicks, `showdown took ${picks} picks (expected ${expectedPicks})`);
    await page.waitForTimeout(700);
    const sdWinner = await page.textContent("#admit-title");
    const titles = await page.$$eval("#matches-list .r-title", n => n.map(x => x.textContent));
    check(titles.includes(sdWinner), "showdown winner is a match: " + sdWinner);
    await page.screenshot({ path: path.join(shots, "7-winner.png"), fullPage: true });
  }

  // persistence
  await page.click("#settings-btn");
  check(/Kevin, Sara, Ola/.test(await page.textContent("#history-list")), "history lists this movie night");
  await page.reload();
  check((await page.inputValue("#player-list li:nth-child(3) input")) === "Ola", "names remembered after reload");
  check(/1 marked/.test(await page.textContent("#seen-count")), `"Seen it" remembered (${seenTitle})`);
  check(/569 of 570/.test(await page.textContent("#pool-count")), "the seen movie is hidden from new stacks");

  // =====================================================================
  section("3. Each on their own phone (share link)");
  const host = await newPhone();
  await host.page.goto(BASE);
  await host.page.fill("#player-list li:nth-child(1) input", "Kåre");
  await host.page.fill("#player-list li:nth-child(2) input", "Siri");
  await host.page.click('#mode [data-mode="link"]');
  await host.page.click('#deck-size [data-size="10"]');
  await host.page.click("#start-btn");
  const hostVotes = await playTurn(host.page, "Kåre", m => (m.title.length % 3 === 0 ? "n" : "y"));
  check(await host.page.isVisible("#screen-send"), "host sees 'Send it to Siri'");
  const link = await host.page.inputValue("#link-box");
  check(link.startsWith(BASE) && /#s=[A-Za-z0-9_-]+$/.test(link), "a share link is created");
  check(link.length < 600, `link is short enough for a chat (${link.length} chars)`);
  await host.page.screenshot({ path: path.join(shots, "8-send-link.png") });

  const guest = await newPhone(); // a different browser profile = a different phone
  await guest.page.goto(link);
  check(await guest.page.isVisible("#screen-invite"), "the link opens an invite on the other phone");
  check(/Your turn, Siri/.test(await guest.page.textContent("#invite-title")), "invite greets Siri");
  check(/Kåre started/.test(await guest.page.textContent("#invite-from")), "names with æøå survive the link");
  await guest.page.screenshot({ path: path.join(shots, "9-invite.png") });
  await guest.page.click("#invite-start");
  const guestVotes = await playTurn(guest.page, "Siri", m => (m.title.length % 2 === 0 ? "n" : "y"));
  check(await guest.page.isVisible("#screen-results"), "the last person gets the results");
  check(sameSet(Object.keys(hostVotes), Object.keys(guestVotes)), "both phones had the same movies");
  const exp2 = expected(Object.keys(hostVotes), [hostVotes, guestVotes]);
  check(sameSet(await listIds(guest.page, "#matches-list"), exp2.matches), `matches across two phones are correct (${exp2.matches.length})`);
  check(/Send results to Kåre/.test(await guest.page.textContent("#sendback-btn")), "the last person is asked to send the results back to Kåre");
  check(/send the results back to you/.test(await host.page.textContent("#send-text")), "the host is told the results come back to them");
  let guestWinner = null;
  if (!(await guest.page.isHidden("#draw-btn"))) {
    await guest.page.click("#draw-btn");
    await guest.page.waitForTimeout(3000);
    guestWinner = await guest.page.textContent("#admit-title");
    check(/Tell Kåre what you're watching/.test(await guest.page.textContent("#sendback-title")), "after the draw the panel says to tell Kåre");
  }
  await guest.page.screenshot({ path: path.join(shots, "10-send-results.png"), fullPage: true });
  await guest.page.reload();
  await guest.page.waitForTimeout(400);
  check(await guest.page.isVisible("#screen-results"), "a reload keeps the results (no swiping again)");
  if (guestWinner) check((await guest.page.textContent("#admit-title")) === guestWinner, "and keeps the drawn movie");
  check(await guest.page.isVisible("#sendback"), "and still offers to send the results to Kåre");
  check((await guest.page.evaluate(() => JSON.parse(localStorage.getItem("mnm.history.v1")).length)) === 1, "the reload doesn't add the same night to history twice");
  const resultsLink = await guest.page.inputValue("#sendback-link");
  await host.page.goto(resultsLink);
  await host.page.waitForTimeout(400);
  check(await host.page.isVisible("#screen-results"), "the results link opens the results on the host's phone");
  check(sameSet(await listIds(host.page, "#matches-list"), exp2.matches), "both phones show the same matches");
  if (guestWinner) check((await host.page.textContent("#admit-title")) === guestWinner, `both phones show the same movie: ${guestWinner}`);
  check(await host.page.isHidden("#sendback"), "the host isn't asked to send the results back again");
  check(await host.page.$eval(".admit", a => getComputedStyle(a, "::before").writingMode === "vertical-rl" && getComputedStyle(a, "::before").transform === "none"), "'Admit all' reads top to bottom (not rotated upside down)");
  await host.page.screenshot({ path: path.join(shots, "11-host-results.png"), fullPage: true });
  if (guestWinner) {
    await guest.page.click("#draw-btn");
    await guest.page.waitForTimeout(200);
    await guest.page.click("#rematch-btn"); // leave while the draw is still spinning
    await guest.page.waitForTimeout(3000);
    check(await guest.page.isVisible("#screen-setup") && await guest.page.$eval("#confetti", c => getComputedStyle(c).display === "none"),
      "leaving during a draw cancels it (no confetti on the next screen)");
  }

  const broken = await newPhone();
  await broken.page.goto(BASE + "#s=thisIsNotAValidGame");
  check(await broken.page.isVisible("#screen-setup"), "a broken link falls back to the setup screen");
  check(/broken/.test(await broken.page.textContent("#toast")), "and explains the link is broken");

  // =====================================================================
  section("4. Works offline after the first visit");
  const off = await newPhone();
  await off.page.goto(BASE);
  const swReady = await off.page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  check(swReady, "service worker is installed");
  await off.page.waitForTimeout(500);
  await off.ctx.setOffline(true);
  await off.page.reload();
  check(/570 of 570/.test(await off.page.textContent("#pool-count")), "app loads and works with no network");
  await off.ctx.setOffline(false);

  // =====================================================================
  section("5. About page");
  await page.goto(BASE + "about.html");
  check(/How this app was made/.test(await page.textContent("h1")), "about page loads");
  await page.click("text=Back to the app");
  check(await page.isVisible("#screen-setup"), "and links back to the app");

  section("6. Quality checks");
  check(maxOverflow === 0, `no horizontal scrollbar while swiping (extra width ${maxOverflow}px)`);
  check(errors.length === 0, "no JavaScript errors" + (errors.length ? ": " + errors.join(" | ") : ""));
} catch (e) {
  failures++;
  console.log("  FAIL crashed: " + e.message);
} finally {
  await browser.close();
  server.close();
}
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
