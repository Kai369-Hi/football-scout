/*
 * Football Scout - browser logic
 * ------------------------------
 * Mirrors src/scouting.py (find_alternatives) so the website and the
 * notebooks give the same ranking. Python prepares the data (docs/data.js);
 * this file only compares, filters and ranks.
 */
"use strict";

const DATA = window.SCOUT_DATA;
const PLAYERS = DATA.players;
const BY_ID = new Map(PLAYERS.map((p) => [p.id, p]));
const LEAGUES = ["Premier League", "La Liga", "Bundesliga", "Serie A", "Ligue 1"];
const ROLE_NAME = { ST: "Striker", W: "Winger", AM: "Attacking midfielder", CM: "Central midfielder", CB: "Centre-back", FB: "Full-back" };
const EXAMPLES = ["Pedri", "Erling Haaland", "Bukayo Saka", "Declan Rice", "Achraf Hakimi"];
const MAX_RESULTS = 15;
// Full-backs and wingers are split by flank: the stats alone cannot tell a left-back from a right-back.
const SIDED = new Set(["FB", "W"]);
const sideOf = (sub) => (sub?.startsWith("Left") ? "L" : sub?.startsWith("Right") ? "R" : null);
const FOOT = { left: "left-footed", right: "right-footed", both: "two-footed" };
const initials = (name) => name.split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
// Photo if we have one; the initials underneath show if it is missing or fails to load.
const avatar = (p, cls = "") => `<span class="avatar role-${p.role} ${cls}" aria-hidden="true">${esc(initials(p.name))}${
  p.photo ? `<img src="${esc(p.photo)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ""}</span>`;

const $ = (sel) => document.querySelector(sel);
const state = { target: null, open: null };

/* ---------- maths (same as Python) ---------- */

// Python's round() uses banker's rounding; for scores this tiny difference never changes a ranking.
const round = (x, d) => { const f = 10 ** d; return Math.round(x * f) / f; };

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

function readFilters() {
  const w = {
    style: +$("#w-style").value, level: +$("#w-level").value, value: +$("#w-value").value,
  };
  const total = w.style + w.level + w.value || 1;
  return {
    maxValue: +$("#budget").value >= 200 ? null : +$("#budget").value,
    cheaperOnly: $("#cheaper")?.checked ?? true,
    ageMin: +$("#age-min").value || 16,
    ageMax: +$("#age-max").value || 42,
    leagues: [...document.querySelectorAll("#leagues input:checked")].map((i) => i.value),
    foot: document.querySelector('input[name="foot"]:checked').value,
    sameRole: $("#same-role")?.checked ?? true,
    sameSide: $("#same-side")?.checked ?? true,
    minLevel: +$("#min-level").value,
    weights: { style: w.style / total, level: w.level / total, value: w.value / total },
  };
}

function findAlternatives(target, f) {
  const out = [];
  for (const p of PLAYERS) {
    if (p.id === target.id || p.pos !== target.pos) continue;
    if (f.sameRole && p.role !== target.role) continue;
    if (f.sameSide && SIDED.has(target.role) && sideOf(p.sub) !== sideOf(target.sub)) continue;
    if (f.cheaperOnly && !(p.value < target.value)) continue;
    if (f.maxValue !== null && p.value > f.maxValue) continue;
    if (p.age < f.ageMin || p.age > f.ageMax) continue;
    if (f.leagues.length < LEAGUES.length && !f.leagues.includes(p.league)) continue;
    if (f.foot && p.foot !== f.foot && p.foot !== "both") continue;

    const levelRatio = round(p.level / target.level, 2);
    if (levelRatio < f.minLevel) continue;

    const sim = round(cosine(target.z, p.z), 3);
    const style = Math.min(Math.max(sim, 0), 1);
    const level = Math.min(levelRatio, 1);
    const value = (Math.min(Math.max(Math.log2(p.ratio), -1), 2) + 1) / 3;
    const score = round(100 * (f.weights.style * style + f.weights.level * level + f.weights.value * value), 1);
    out.push({ p, sim, levelRatio, style, level, value, score });
  }
  // Ties: higher style similarity first, then name (same rule as src/scouting.py)
  out.sort((a, b) => b.score - a.score || b.sim - a.sim || (a.p.name < b.p.name ? -1 : a.p.name > b.p.name ? 1 : 0));
  return out.slice(0, MAX_RESULTS);
}

/* ---------- formatting ---------- */

const money = (m) => (m == null ? "n/a" : m >= 10 ? `€${Math.round(m)}m` : m >= 1 ? `€${m.toFixed(1).replace(/\.0$/, "")}m` : `€${Math.round(m * 1000)}k`);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const normal = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const contractYear = (p) => (p.contract ? +p.contract.slice(0, 4) : null);

/* ---------- search ---------- */

let suggestionIndex = -1;

function searchPlayers(q) {
  const k = normal(q);
  if (k.length < 2) return [];
  const starts = [], contains = [];
  for (const p of PLAYERS) {
    const words = p.key.split(/\s+/);
    if (p.key.startsWith(k) || words.some((w) => w.startsWith(k))) starts.push(p);
    else if (p.key.includes(k)) contains.push(p);
  }
  const byValue = (a, b) => b.value - a.value;
  return [...starts.sort(byValue), ...contains.sort(byValue)].slice(0, 8);
}

function renderSuggestions(list) {
  const ul = $("#suggestions");
  const box = $(".search");
  suggestionIndex = -1;
  if (!list.length) { ul.hidden = true; box.setAttribute("aria-expanded", "false"); return; }
  ul.innerHTML = list.map((p, i) => `
    <li role="option" id="opt-${i}" data-id="${esc(p.id)}" aria-selected="false">
      <span class="s-name">${esc(p.name)}</span>
      <span class="s-meta">${esc(p.sub)}, ${esc(p.squad)}</span>
    </li>`).join("");
  ul.hidden = false;
  box.setAttribute("aria-expanded", "true");
}

function moveSuggestion(step) {
  const items = [...document.querySelectorAll("#suggestions li")];
  if (!items.length) return;
  suggestionIndex = (suggestionIndex + step + items.length) % items.length;
  items.forEach((li, i) => li.setAttribute("aria-selected", String(i === suggestionIndex)));
  $("#q").setAttribute("aria-activedescendant", items[suggestionIndex].id);
  items[suggestionIndex].scrollIntoView({ block: "nearest" });
}

function choose(id) {
  const p = BY_ID.get(id);
  if (!p) return;
  state.target = p;
  state.open = null;
  $("#q").value = p.name;
  renderSuggestions([]);
  history.replaceState(null, "", `#${encodeURIComponent(p.id)}`);
  renderTarget();
  renderResults();
  document.getElementById("target").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
}

/* ---------- target card ---------- */

function renderTarget() {
  const p = state.target;
  const el = $("#target");
  el.hidden = false;
  el.innerHTML = `
    <div class="t-who">
      ${avatar(p, "big")}
      <div>
        <p class="t-label">Looking for alternatives to</p>
        <h2>${esc(p.name)}</h2>
        <p class="t-meta">${esc(p.sub)}, ${esc(FOOT[p.foot] || "foot unknown")}, age ${Math.floor(p.age)}. ${esc(p.squad)}, ${esc(p.league)}. ${p.minutes.toLocaleString()} minutes</p>
      </div>
    </div>
    <dl class="stats">
      <div><dt>Market value</dt><dd>${money(p.value)}</dd></div>
      <div><dt>Model estimate</dt><dd>${money(p.pred)}</dd></div>
      <div><dt>Output score</dt><dd>${Math.round(p.level)}</dd></div>
    </dl>`;
}

/* ---------- results ---------- */

function renderResults() {
  const list = $("#results");
  const head = $("#results-head");
  const empty = $("#empty");
  if (!state.target) { list.innerHTML = ""; head.innerHTML = ""; empty.hidden = false; return; }

  const f = readFilters();
  const rows = findAlternatives(state.target, f);
  head.innerHTML = `
    <h2>${rows.length ? `Top ${rows.length} alternatives` : "No alternatives found"}</h2>
    <dl class="score-key">
      <div><dt><i class="key style"></i>Style match</dt><dd>How similar his playing profile is</dd></div>
      <div><dt><i class="key level"></i>Output level</dt><dd>His production compared with ${esc(state.target.name.split(" ").slice(-1)[0])}'s</dd></div>
      <div><dt><i class="key value"></i>Value for money</dt><dd>How cheap he is against the model's price</dd></div>
    </dl>`;

  if (!rows.length) {
    list.innerHTML = "";
    empty.hidden = false;
    empty.innerHTML = `<p>No player passes every filter. Raise the budget, widen the age range, lower the minimum output or allow other roles.</p>`;
    return;
  }
  empty.hidden = true;

  list.innerHTML = rows.map((r, i) => {
    const p = r.p;
    const cy = contractYear(p);
    const tags = [];

    if (cy && cy <= 2027) tags.push(`<span class="tag opportunity">Contract ends ${cy}</span>`);
    if (p.age >= 32) tags.push(`<span class="tag caution">Age ${Math.floor(p.age)}: value model less reliable</span>`);
    if (p.minutes < 1300) tags.push(`<span class="tag caution">Only ${p.minutes} minutes</span>`);
    const ratioText = p.ratio >= 1.15
      ? `<span class="ratio-up">Model says ${money(p.pred)} (${p.ratio.toFixed(1)}×)</span>`
      : `Model says ${money(p.pred)}`;
    const w = f.weights;
    const seg = (cls, part, weight) => `<i class="${cls}" style="width:${(part * weight * 100).toFixed(1)}%"></i>`;
    return `
      <li class="result" data-id="${esc(p.id)}">
        <button type="button" aria-expanded="${state.open === p.id}" aria-controls="d-${i}">
          <span class="rank">${i + 1}</span>
          <span class="who">${avatar(p)}<span><strong>${esc(p.name)}</strong><span class="pos">${esc(p.sub)}, ${esc(FOOT[p.foot] || "foot unknown")}, age ${Math.floor(p.age)}</span><span>${esc(p.squad)}, ${esc(p.league)}</span></span></span>
          <span class="money"><b>${money(p.value)}</b><span class="est">${ratioText}</span></span>
          <span class="bar-cell"><span class="bar" role="img" title="Style match ${Math.round(r.style * 100)}/100, output level ${Math.round(r.level * 100)}/100, value for money ${Math.round(r.value * 100)}/100" aria-label="Style match ${Math.round(r.style * 100)}, output level ${Math.round(r.level * 100)}, value for money ${Math.round(r.value * 100)}">${seg("s", r.style, w.style)}${seg("l", r.level, w.level)}${seg("v", r.value, w.value)}</span></span>
          <span class="score" aria-label="Score ${r.score}">${Math.round(r.score)}</span>
          ${tags.length ? `<span class="tags">${tags.join("")}</span>` : ""}
        </button>
        <div class="detail" id="d-${i}" ${state.open === p.id ? "" : "hidden"}>${state.open === p.id ? detail(r) : ""}</div>
      </li>`;
  }).join("");
}

function detail(r) {
  const t = state.target, p = r.p;
  const labels = DATA.features[t.pos];
  const rowsHtml = labels.map((lab, k) => `
    <tr><td>${esc(lab)}</td><td>${t.pct[k] ?? "n/a"}</td><td>${p.pct[k] ?? "n/a"}</td></tr>`).join("");
  return `
    <div class="radar-wrap">
      ${radar(labels, t.pct, p.pct)}
      <div class="radar-legend"><span><i class="key t"></i>${esc(t.name)}</span><span><i class="key c"></i>${esc(p.name)}</span></div>
    </div>
    <div>
      <table class="compare">
        <thead><tr><th>Percentile in position</th><th>${esc(t.name)}</th><th>${esc(p.name)}</th></tr></thead>
        <tbody>
          ${rowsHtml}
          <tr><td>Output score</td><td>${Math.round(t.level)}</td><td>${Math.round(p.level)}</td></tr>
          <tr><td>Market value</td><td>${money(t.value)}</td><td>${money(p.value)}</td></tr>
          <tr><td>Model estimate</td><td>${money(t.pred)}</td><td>${money(p.pred)}</td></tr>
          <tr><td>Contract until</td><td>${t.contract ? t.contract.slice(0, 4) : "n/a"}</td><td>${p.contract ? p.contract.slice(0, 4) : "n/a"}</td></tr>
        </tbody>
      </table>
      <p class="why">Style match <b>${r.sim.toFixed(2)}</b> (1 = identical profile), output at <b>${Math.round(r.levelRatio * 100)}%</b> of ${esc(t.name.split(" ").slice(-1)[0])}'s, and the value model rates him at <b>${p.ratio.toFixed(2)}×</b> his market price${p.ratio < 1 ? ", so he is not a bargain on numbers alone" : ""}.</p>
    </div>`;
}

function radar(labels, a, b) {
  const n = labels.length, size = 300, c = size / 2, R = 104;
  const pt = (i, v) => {
    const ang = -Math.PI / 2 + (2 * Math.PI * i) / n;
    const r = (R * (v ?? 0)) / 100;
    return [c + r * Math.cos(ang), c + r * Math.sin(ang)];
  };
  const poly = (vals) => vals.map((v, i) => pt(i, v).join(",")).join(" ");
  const rings = [25, 50, 75, 100].map((v) => `<polygon class="r-grid" points="${poly(Array(n).fill(v))}"/>`).join("");
  const axes = labels.map((_, i) => { const [x, y] = pt(i, 100); return `<line class="r-axis" x1="${c}" y1="${c}" x2="${x}" y2="${y}"/>`; }).join("");
  const text = labels.map((lab, i) => {
    const [x, y] = pt(i, 128);
    const anchor = Math.abs(x - c) < 8 ? "middle" : x > c ? "start" : "end";
    return `<text class="r-label" x="${x}" y="${y + 4}" text-anchor="${anchor}">${esc(lab)}</text>`;
  }).join("");
  return `<svg viewBox="-70 0 ${size + 140} ${size}" role="img" aria-label="Radar chart comparing percentiles">${rings}${axes}
    <polygon class="r-target" points="${poly(a)}"/><polygon class="r-cand" points="${poly(b)}"/>${text}</svg>`;
}

/* ---------- wiring ---------- */

function syncOutputs() {
  const b = +$("#budget").value;
  $("#budget-out").textContent = b >= 200 ? "Any" : `€${b}m`;
  $("#min-level-out").textContent = `${Math.round(+$("#min-level").value * 100)}%`;
  const f = readFilters();
  $("#w-style-out").textContent = `${Math.round(f.weights.style * 100)}%`;
  $("#w-level-out").textContent = `${Math.round(f.weights.level * 100)}%`;
  $("#w-value-out").textContent = `${Math.round(f.weights.value * 100)}%`;
}

function resetFilters() {
  $("#budget").value = 200; $("#cheaper").checked = true;
  $("#age-min").value = 16; $("#age-max").value = 42;
  document.querySelectorAll("#leagues input").forEach((i) => { i.checked = true; });
  document.querySelector('input[name="foot"][value=""]').checked = true;
  $("#same-role").checked = true; $("#same-side").checked = true; $("#min-level").value = 0.8;
  $("#w-style").value = 5; $("#w-level").value = 3; $("#w-value").value = 2;
  syncOutputs(); renderResults();
}

function init() {
  $("#season").textContent = DATA.season;
  $("#generated").textContent = DATA.generated;

  $("#leagues").innerHTML = LEAGUES.map((l) => `<label><input type="checkbox" value="${l}" checked><span>${l}</span></label>`).join("");

  $("#example-list").innerHTML = EXAMPLES.filter((n) => PLAYERS.some((p) => p.name === n))
    .map((n) => `<button type="button" data-name="${esc(n)}">${esc(n)}</button>`).join("");
  $("#example-list").addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (btn) choose(PLAYERS.find((p) => p.name === btn.dataset.name).id);
  });

  const q = $("#q");
  q.addEventListener("input", () => renderSuggestions(searchPlayers(q.value)));
  q.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); moveSuggestion(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); moveSuggestion(-1); }
    else if (e.key === "Enter") {
      const items = [...document.querySelectorAll("#suggestions li")];
      const pick = items[Math.max(suggestionIndex, 0)];
      if (pick) { e.preventDefault(); choose(pick.dataset.id); }
    } else if (e.key === "Escape") renderSuggestions([]);
  });
  $("#suggestions").addEventListener("mousedown", (e) => {
    const li = e.target.closest("li");
    if (li) { e.preventDefault(); choose(li.dataset.id); }
  });
  q.addEventListener("blur", () => setTimeout(() => renderSuggestions([]), 120));

  $("#filter-panel").addEventListener("input", () => { syncOutputs(); renderResults(); });
  $("#reset").addEventListener("click", resetFilters);

  $("#results").addEventListener("click", (e) => {
    const btn = e.target.closest(".result > button");
    if (!btn) return;
    const id = btn.parentElement.dataset.id;
    state.open = state.open === id ? null : id;
    renderResults();
    const again = document.querySelector(`.result[data-id="${CSS.escape(id)}"] > button`);
    if (again) again.focus();
  });

  if (matchMedia("(max-width: 900px)").matches) $("#filter-panel").open = false;

  syncOutputs();
  const fromHash = decodeURIComponent(location.hash.slice(1));
  if (fromHash && BY_ID.has(fromHash)) choose(fromHash);
}

// In the browser, start the page. In Node (tests/parity.js), only export the maths.
if (typeof document !== "undefined") init();
if (typeof module !== "undefined") module.exports = { findAlternatives, BY_ID, PLAYERS };
