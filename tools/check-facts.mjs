// Cross-checks data/movies.txt against two open datasets:
//   - Wikipedia movie data (prust/wikipedia-movie-data): year + cast, American films 1900–2023
//   - vega-datasets movies.json: runtime + director, ~3,200 films up to ~2010 (known to contain errors!)
// Flags are hints for a human to review, not automatic truth.
// Usage: node tools/check-facts.mjs   (downloads the datasets into .cache/ the first time)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "./build-movies.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const cache = path.join(root, ".cache");
const SOURCES = {
  wiki: "https://raw.githubusercontent.com/prust/wikipedia-movie-data/master/movies.json",
  vega: "https://raw.githubusercontent.com/vega/vega-datasets/main/data/movies.json"
};

async function load(name) {
  const file = path.join(cache, name + ".json");
  if (!fs.existsSync(file)) {
    fs.mkdirSync(cache, { recursive: true });
    console.log(`Downloading ${SOURCES[name]} ...`);
    const res = await fetch(SOURCES[name]);
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);
    fs.writeFileSync(file, await res.text());
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

const norm = s => String(s).normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/&/g, "and").replace(/^(the|a|an) /, "").replace(/[^a-z0-9]/g, "");
const group = (list, key) => list.reduce((m, x) => { const k = key(x); if (k) (m[k] ||= []).push(x); return m; }, {});

const { movies } = parse(fs.readFileSync(path.join(root, "data", "movies.txt"), "utf8"));
const wiki = group(await load("wiki"), m => norm(m.title));
const vega = group(await load("vega"), m => m.Title != null && norm(m.Title));

const reviewed = new Set(fs.readFileSync(path.join(root, "data", "reviewed-flags.txt"), "utf8")
  .split(/\r?\n/).filter(l => l && !l.startsWith("#")).map(l => l.split("|").slice(0, 3).join("|")));
let flags = 0, ok = 0, wChecked = 0, vChecked = 0, current = null;
const flag = msg => {
  const kind = msg.split(/\s+/)[0];
  if (reviewed.has(`${kind}|${current.title}|${current.year}`)) { ok++; return; }
  flags++; console.log("  ? " + msg);
};
for (const m of movies) {
  current = m;
  const k = norm(m.title);
  const ws = wiki[k] || [];
  if (ws.length) {
    const best = ws.reduce((a, b) => Math.abs(a.year - m.year) <= Math.abs(b.year - m.year) ? a : b);
    if (Math.abs(best.year - m.year) <= 1) {
      wChecked++;
      const theirs = (best.cast || []).map(norm);
      if (theirs.length && m.cast.length && !m.cast.some(c => theirs.includes(norm(c))))
        flag(`CAST     ${m.title} (${m.year}): ours ${m.cast.join(", ")} / Wikipedia ${best.cast.slice(0, 3).join(", ")}`);
    } else if (m.country === "US" && m.year <= 2023) {
      flag(`YEAR     ${m.title} (${m.year}): Wikipedia has ${ws.map(w => w.year).join(", ")}`);
    }
  }
  for (const v of vega[k] || []) {
    const vy = Number((String(v["Release Date"] || "").match(/\d{4}/) || [])[0]);
    if (vy && Math.abs(vy - m.year) > 1) continue;
    vChecked++;
    const vr = v["Running Time min"], vd = v.Director;
    if (vr && Math.abs(vr - m.runtime) > 6) flag(`RUNTIME  ${m.title} (${m.year}): ours ${m.runtime} / vega ${vr}`);
    if (vd && !m.director.split(",").some(d => norm(vd).includes(norm(d)) || norm(d).includes(norm(vd))))
      flag(`DIRECTOR ${m.title} (${m.year}): ours ${m.director} / vega ${vd}`);
    break;
  }
}
console.log(`\nChecked ${wChecked} movies against Wikipedia and ${vChecked} against vega.`);
console.log(`${ok} known flag(s) already reviewed (data/reviewed-flags.txt), ${flags} new flag(s) to review.`);
process.exit(flags ? 1 : 0);
