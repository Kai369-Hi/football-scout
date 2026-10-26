// Checks that the website (docs/app.js) ranks players exactly like Python (src/scouting.py).
// Run from the project root:  node tests/parity.js
const fs = require("fs");
const path = require("path");
const vm = require("vm");

global.window = {};
vm.runInThisContext(fs.readFileSync(path.join(__dirname, "..", "docs", "data.js"), "utf8"));
const { findAlternatives, PLAYERS } = require("../docs/app.js");

const expected = JSON.parse(fs.readFileSync(path.join(__dirname, "expected.json"), "utf8"));
const defaults = {
  maxValue: null, cheaperOnly: true, ageMin: 16, ageMax: 42,
  leagues: ["Premier League", "La Liga", "Bundesliga", "Serie A", "Ligue 1"],
  foot: "", sameRole: true, sameSide: true, minLevel: 0.8,
  weights: { style: 0.5, level: 0.3, value: 0.2 },
};

let failures = 0;
for (const c of expected) {
  const target = PLAYERS.find((p) => p.name === c.target);
  const f = { ...defaults, ...c.filters };
  const got = findAlternatives(target, f).slice(0, c.rows.length);
  c.rows.forEach((row, i) => {
    const g = got[i];
    const ok = g && g.p.name === row.player && Math.abs(g.score - row.alt_score) <= 0.15;
    if (!ok) {
      failures++;
      console.log(`❌ ${c.label} #${i + 1}: Python ${row.player} ${row.alt_score} vs JS ${g ? g.p.name + " " + g.score : "none"}`);
    }
  });
  console.log(`${c.label}: checked ${c.rows.length} rows`);
}
console.log(failures ? `\n${failures} mismatches` : "\n✅ JavaScript matches Python on every checked row");
process.exit(failures ? 1 : 0);
