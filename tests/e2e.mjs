// End-to-end test: plays a full movie night in a phone-sized browser.
// Needs Playwright:  npm install  (then)  npx playwright install chromium
// Usage: node tests/e2e.mjs . screenshots
//   or against a server:  APP_URL=http://localhost:8000/index.html node tests/e2e.mjs . screenshots
import { chromium } from "playwright";
import path from "node:path";
import fs from "node:fs";

const appDir = path.resolve(process.argv[2] || ".");
const shots = path.resolve(process.argv[3] || "screenshots");
fs.mkdirSync(shots, { recursive: true });
const url = process.env.APP_URL || ("file://" + path.join(appDir, "index.html"));

const errors = [];
let failures = 0;
const check = (cond, msg) => { console.log((cond ? "PASS " : "FAIL ") + msg); if (!cond) failures++; };

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
page.on("pageerror", e => errors.push(e.message));
page.on("console", m => { if (m.type() === "error" && !/fonts\.g/.test(m.text()) && !/ERR_/.test(m.text())) errors.push(m.text()); });

await page.goto(url);
await page.screenshot({ path: path.join(shots, "1-setup.png"), fullPage: true });

// --- setup ---
const poolAll = await page.textContent("#pool-count");
check(/80 movies fit/.test(poolAll), "pool shows all 80 movies with no filters: " + poolAll);
await page.fill("#name-a", "Kevin");
await page.fill("#name-b", "Sara");
await page.click('#deck-size [data-size="10"]');
await page.click('[data-genre="Comedy"]');
const poolComedy = await page.textContent("#pool-count");
check(/You'll each swipe 10/.test(poolComedy), "genre filter + deck size updates the count: " + poolComedy);
// impossible filter disables start
await page.check("#norwegian-only");
await page.selectOption("#max-runtime", "105");
await page.click('[data-genre="Comedy"]'); // off
await page.click('[data-genre="Musical"]'); // no Norwegian musicals
check(await page.isDisabled("#start-btn"), "start button disabled when no movies fit");
await page.click('[data-genre="Musical"]');
await page.uncheck("#norwegian-only");
await page.selectOption("#max-runtime", "0");
await page.click('[data-genre="Comedy"]');
await page.click("#start-btn");

const topId = () => page.$eval("#stack .ticket:not(.is-next)", n => Number(n.dataset.id));
const ruleA = id => id % 5 === 0 ? "super" : id % 2 === 1 ? "yes" : "no";
const ruleB = id => id % 3 !== 0 ? "yes" : "no";
const votes = [{}, {}];

async function vote(kind, how) {
  if (how === "drag") {
    const box = await (await page.$("#stack .ticket:not(.is-next)")).boundingBox();
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    const dx = kind === "yes" ? 180 : kind === "no" ? -180 : 0;
    const dy = kind === "super" ? -200 : 0;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    for (let s = 1; s <= 8; s++) await page.mouse.move(cx + dx * s / 8, cy + dy * s / 8);
    await page.mouse.up();
  } else if (how === "key") {
    await page.keyboard.press({ yes: "ArrowRight", no: "ArrowLeft", super: "ArrowUp" }[kind]);
  } else {
    await page.click(`.actions [data-vote="${kind}"]`);
  }
  await page.waitForTimeout(450);
}

async function playTurn(player, rule) {
  const name = await page.textContent("#turn-name");
  check(name === (player === 0 ? "Kevin" : "Sara"), `turn shows ${name}`);
  const total = Number((await page.textContent("#turn-count")).split(" of ")[1]);
  let i = 0;
  while (await page.$("#stack .ticket:not(.is-next)")) {
    const id = await topId();
    if (player === 0 && i === 1) {
      // test undo: answer wrong, undo, then answer right
      await vote("no", "button");
      await page.click("#undo-btn");
      await page.waitForTimeout(100);
      check(await topId() === id, "undo brings the same card back");
    }
    if (player === 0 && i === 2) await page.screenshot({ path: path.join(shots, "2-swipe.png") });
    const k = rule(id);
    votes[player][id] = k;
    await vote(k, ["drag", "button", "key"][i % 3]);
    i++;
    if (i > 40) break;
  }
  check(i === total, `${name} answered all ${total} cards (${i})`);
}

await playTurn(0, ruleA);
check(await page.isVisible("#screen-handoff"), "hand-off screen shown after first player");
await page.screenshot({ path: path.join(shots, "3-handoff.png") });
await page.click("#handoff-btn");
await playTurn(1, ruleB);

// --- results ---
check(await page.isVisible("#screen-results"), "results screen shown");
const deckIds = Object.keys(votes[0]).map(Number);
check(deckIds.length === Object.keys(votes[1]).length && deckIds.every(id => id in votes[1]), "both players saw the same movies");
const expected = deckIds.filter(id => votes[0][id] !== "no" && votes[1][id] !== "no");
const shown = await page.$$eval("#matches-list li", lis => lis.map(l => Number(l.dataset.id)));
check(expected.length === shown.length && expected.every(id => shown.includes(id)),
  `matches on screen (${shown.length}) equal expected (${expected.length})`);
await page.screenshot({ path: path.join(shots, "4-results.png"), fullPage: true });

if (shown.length) {
  await page.click("#draw-btn");
  await page.waitForTimeout(3000);
  const winner = await page.textContent("#admit-title");
  const titles = await page.$$eval("#matches-list .r-title", n => n.map(x => x.textContent));
  check(titles.includes(winner), "winner is one of the matches: " + winner);
  check(await page.$("#matches-list li.is-winner") !== null, "winner highlighted in list");
  await page.screenshot({ path: path.join(shots, "5-winner.png"), fullPage: true });
}

// --- persistence ---
await page.click("#settings-btn");
const hist = await page.textContent("#history-list");
check(/Kevin & Sara/.test(hist), "history lists this movie night: " + hist.trim());
await page.reload();
check(await page.inputValue("#name-a") === "Kevin", "names remembered after reload");
check(await page.getAttribute('[data-genre="Comedy"]', "aria-pressed") === "true", "genre remembered after reload");
await page.screenshot({ path: path.join(shots, "6-setup-with-history.png"), fullPage: true });

check(errors.length === 0, "no JavaScript errors" + (errors.length ? ": " + errors.join(" | ") : ""));
await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
