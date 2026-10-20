// Update test: a phone has an older version installed, then a new version is deployed.
// Checks that new buttons work right after the update (old and new files must never mix).
// Simulates GitHub Pages, which lets browsers keep files for 10 minutes (Cache-Control: max-age=600).
// Setup once: npm install && npx playwright install chromium
// Run:        npm run test:update              (old version = commit 0f5feb4, before "Our own list")
//             node tests/update.mjs <commit>   (any older commit)
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const oldCommit = process.argv[2] || "0f5feb4";
const oldDir = fs.mkdtempSync(path.join(os.tmpdir(), "mnm-old-"));
fs.rmSync(oldDir, { recursive: true, force: true });
execFileSync("git", ["worktree", "add", "--detach", "--force", oldDir, oldCommit], { cwd: repo, stdio: "ignore" });

let root = oldDir, failures = 0;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2" };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p.endsWith("/")) p += "index.html";
  const f = path.join(root, p);
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream", "Cache-Control": "max-age=600" });
  fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const URL0 = `http://127.0.0.1:${server.address().port}/`;
const check = (ok, msg) => { if (!ok) failures++; console.log((ok ? "  PASS " : "  FAIL ") + msg); };

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
try {
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await page.goto(URL0);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  check(!(await page.$('[data-source="own"]')), `phone runs the old version (${oldCommit}) with its offline copy`);

  root = repo; // ---- deploy the new version
  let sawNewPage = false, mixed = false;
  for (let i = 1; i <= 3; i++) {
    await page.reload();
    await page.waitForTimeout(1200);
    const btn = await page.$('[data-source="own"]');
    if (!btn) continue;
    sawNewPage = true;
    await btn.click();
    await page.waitForTimeout(200);
    if (!(await page.isVisible("#own-list"))) mixed = true;
  }
  check(sawNewPage, "the new version shows up within 3 reloads");
  check(!mixed, "'Our own list' works every time the new page is shown (no old app.js mixed in)");
  const versions = await page.evaluate(() => ({ app: window.APP_VERSION }));
  check(!!versions.app, "the running app.js is the new one (version " + versions.app + ")");
} finally {
  await browser.close();
  server.close();
  execFileSync("git", ["worktree", "remove", "--force", oldDir], { cwd: repo, stdio: "ignore" });
}
console.log(failures ? `\n${failures} check(s) failed` : "\nAll update checks passed");
process.exit(failures ? 1 : 0);
