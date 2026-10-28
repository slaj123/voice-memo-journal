// Combined Journal + Daily Log site. Reads memos/journal/*.json and
// memos/dailylog/*.json and writes one phone-first feed (dist/index.html)
// with client-side filter chips. The whole site sits behind the passcode
// gate in functions/_middleware.js, so nothing here is public.
const fs = require("fs");
const path = require("path");

const MEMOS_ROOT = path.join(__dirname, "..", "..", "memos");
const SOURCES = ["journal", "dailylog"];
const OUT_DIR = path.join(__dirname, "dist");
const STATIC_DIR = path.join(__dirname, "static");
const CONFIG_FILE = path.join(__dirname, "config.json");
const { audioBaseUrl, timeZone } = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
const TZ = timeZone || "America/Los_Angeles";

// Filter chips. Every memo maps to exactly one kind: its category, with two
// conveniences: Daily Log memos and daily rundowns share "Daily Log", and
// goodnight messages get their own "Goodnights" chip. Chips are built from the
// memos (see kindsOf), so your own categories show up without any config.
let KINDS = [];

function kindOf(memo, source) {
  if (source === "dailylog") return "Daily Log";
  if (/goodnight/i.test(memo.subcategory || "")) return "Goodnights";
  if (memo.category === "Daily Reflections") {
    return memo.subcategory === "Personal" ? "Goodnights" : "Daily Log";
  }
  return memo.category || "Other";
}

// Daily Log first, then the rest by how many memos each has.
function kindsOf(memos) {
  const n = new Map();
  for (const m of memos) n.set(m._kind, (n.get(m._kind) || 0) + 1);
  return [...n.keys()].sort((a, b) => (a === "Daily Log" ? -1 : b === "Daily Log" ? 1 : n.get(b) - n.get(a) || a.localeCompare(b)));
}

function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// The day a memo is about: recordedOn when the upload was late (see
// scripts/fix-dates.mjs), else the upload moment in Pacific time.
function dayOf(memo) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(memo.recordedOn || "")) return memo.recordedOn;
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(memo.date));
}

function loadMemos() {
  const memos = [];
  for (const source of SOURCES) {
    const dir = path.join(MEMOS_ROOT, source);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "categories.json")) {
      const memo = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
      memo._kind = kindOf(memo, source);
      memo._id = f.slice(0, -".json".length); // link target: /#e-<file name>, used by the Habits app
      memo._day = dayOf(memo);
      memos.push(memo);
    }
  }
  memos.sort((a, b) => b._day.localeCompare(a._day) || new Date(b.date) - new Date(a.date));
  return memos;
}

function dayParts(day) {
  const d = new Date(`${day}T12:00:00Z`);
  const fmt = (opts) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", ...opts }).format(d);
  return { num: fmt({ day: "numeric" }), dow: fmt({ weekday: "short" }), month: fmt({ month: "long", year: "numeric" }) };
}

function renderRatings(ratings) {
  if (!ratings || !ratings.length) return "";
  return `<p class="ratings">${ratings
    .map((r) => `<span>${escapeHtml(r.label)} <b>${escapeHtml(r.score)}</b></span>`)
    .join("")}</p>`;
}

function renderMemo(memo) {
  const { num, dow } = dayParts(memo._day);
  const search = `${memo.headline} ${memo.summary} ${memo.transcript}`.toLowerCase();
  return `
    <article class="entry" id="e-${escapeHtml(memo._id)}" data-kind="${slugify(memo._kind)}" data-search="${escapeHtml(search)}">
      <div class="spine"><span class="num">${num}</span><span class="dow">${dow}</span></div>
      <details>
        <summary>
          <span class="kind">${escapeHtml(memo._kind)}</span>
          <h2>${escapeHtml(memo.headline)}</h2>
          <p class="summary">${escapeHtml(memo.summary)}</p>
          ${renderRatings(memo.ratings)}
          <span class="more" aria-hidden="true"></span>
        </summary>
        <div class="body">
          ${memo.audioKey ? `<audio controls preload="none" src="${audioBaseUrl}/${escapeHtml(memo.audioKey)}"></audio>` : ""}
          <p class="transcript">${escapeHtml(memo.transcript)}</p>
        </div>
      </details>
    </article>`;
}

function renderFeed(memos) {
  let html = "";
  let month = null;
  for (const memo of memos) {
    const m = dayParts(memo._day).month;
    if (m !== month) {
      if (month !== null) html += "</section>";
      html += `<section class="month"><h3 class="month-label">${m}</h3>`;
      month = m;
    }
    html += renderMemo(memo);
  }
  return html + (month !== null ? "</section>" : "");
}

function page(memos) {
  const counts = Object.fromEntries(KINDS.map((k) => [k, memos.filter((m) => m._kind === k).length]));
  const chips = [
    `<button class="chip" data-filter="all" aria-pressed="true">All <i>${memos.length}</i></button>`,
    ...KINDS.map(
      (k) => `<button class="chip" data-filter="${slugify(k)}" aria-pressed="false">${k} <i>${counts[k]}</i></button>`
    ),
  ].join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Journal</title>
<meta name="theme-color" content="#F6F2EA" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#16130F" media="(prefers-color-scheme: dark)">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="Journal">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="icon" href="/icon-192.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,600;1,6..72,400&family=Archivo:wght@500;600&display=swap" rel="stylesheet">
<style>
  :root {
    --paper: #F6F2EA; --card: #FBF8F2; --ink: #22201C; --muted: #6E675C;
    --rule: #DED6C7; --rust: #9E432A; --rust-soft: #F0DED4;
    color-scheme: light;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --paper: #16130F; --card: #1E1A15; --ink: #EDE6DA; --muted: #A39A8B;
      --rule: #3A332A; --rust: #D9785A; --rust-soft: #3B2219;
      color-scheme: dark;
    }
  }
  * { box-sizing: border-box; }
  html { -webkit-text-size-adjust: 100%; }
  body {
    margin: 0; background: var(--paper); color: var(--ink);
    font: 18px/1.55 "Newsreader", Georgia, serif;
    padding: 0 max(16px, env(safe-area-inset-right)) calc(40px + env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left));
  }
  .wrap { max-width: 680px; margin: 0 auto; }
  header {
    position: sticky; top: 0; z-index: 2; background: var(--paper);
    padding: calc(14px + env(safe-area-inset-top)) 0 10px; border-bottom: 1px solid var(--rule);
  }
  .title-row { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
  h1 { font-size: 30px; font-weight: 600; margin: 0; letter-spacing: -0.01em; }
  .count { font: 500 13px "Archivo", system-ui, sans-serif; color: var(--muted); }
  input[type=search] {
    width: 100%; margin: 10px 0 8px; padding: 10px 12px; font: 500 16px "Archivo", system-ui, sans-serif;
    color: var(--ink); background: var(--card); border: 1px solid var(--rule); border-radius: 10px;
  }
  input[type=search]:focus { outline: 2px solid var(--rust); outline-offset: 1px; }
  .chips { display: flex; gap: 8px; overflow-x: auto; scrollbar-width: none; margin: 0 -16px; padding: 0 16px 2px; }
  .chips::-webkit-scrollbar { display: none; }
  .chip {
    flex: none; min-height: 38px; padding: 0 14px; border-radius: 19px; cursor: pointer;
    font: 600 14px "Archivo", system-ui, sans-serif; color: var(--ink);
    background: transparent; border: 1px solid var(--rule);
  }
  .chip i { font-style: normal; color: var(--muted); font-weight: 500; margin-left: 2px; }
  .chip[aria-pressed="true"] { background: var(--ink); color: var(--paper); border-color: var(--ink); }
  .chip[aria-pressed="true"] i { color: inherit; opacity: 0.7; }
  .month-label {
    font: 600 12px "Archivo", system-ui, sans-serif; text-transform: uppercase; letter-spacing: 0.12em;
    color: var(--rust); margin: 28px 0 6px 56px;
  }
  .month.empty { display: none; }
  .entry { display: grid; grid-template-columns: 44px 1fr; gap: 12px; position: relative; }
  .entry[hidden] { display: none; }
  /* The date spine: a hairline down the left edge, interrupted by each day. */
  .spine { position: relative; text-align: center; padding-top: 16px; }
  .spine::before { content: ""; position: absolute; left: 50%; top: 0; bottom: 0; width: 1px; background: var(--rule); }
  .spine .num, .spine .dow { position: relative; display: block; background: var(--paper); }
  .spine .num { font-size: 24px; font-weight: 600; line-height: 1; padding-top: 2px; }
  .spine .dow { font: 600 11px "Archivo", system-ui, sans-serif; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); padding-bottom: 4px; }
  .spine .same { visibility: hidden; }
  details { border-bottom: 1px solid var(--rule); padding: 14px 0 16px; min-width: 0; }
  summary { list-style: none; cursor: pointer; }
  summary::-webkit-details-marker { display: none; }
  .kind { font: 600 12px "Archivo", system-ui, sans-serif; text-transform: uppercase; letter-spacing: 0.1em; color: var(--rust); }
  h2 { font-size: 21px; line-height: 1.25; font-weight: 600; margin: 4px 0 6px; }
  .summary { margin: 0; color: var(--ink); }
  details:not([open]) .summary { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
  .ratings { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0 0; font: 500 13px "Archivo", system-ui, sans-serif; }
  .ratings span { background: var(--rust-soft); border-radius: 6px; padding: 2px 8px; }
  .more { display: inline-block; margin-top: 8px; font: 600 13px "Archivo", system-ui, sans-serif; color: var(--muted); }
  .more::after { content: "Read transcript"; }
  details[open] .more::after { content: "Hide transcript"; }
  .body { padding-top: 10px; }
  audio { width: 100%; margin-bottom: 10px; }
  .entry.linked h2 { text-decoration: underline; text-decoration-thickness: 2px; text-underline-offset: 4px; }
  .transcript { margin: 0; white-space: pre-wrap; font-size: 17px; color: var(--ink); }
  .none { display: none; text-align: center; color: var(--muted); padding: 48px 0; font-style: italic; }
  .none.show { display: block; }
  footer { margin: 32px 0 0 56px; font: 500 13px "Archivo", system-ui, sans-serif; }
  footer a { color: var(--muted); }
  @media (min-width: 720px) { h1 { font-size: 36px; } .entry { grid-template-columns: 56px 1fr; } }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <div class="title-row"><h1>Journal</h1><span class="count" id="count">${memos.length} entries</span></div>
    <input type="search" id="q" placeholder="Search entries" aria-label="Search entries" autocomplete="off">
    <div class="chips" role="toolbar" aria-label="Filter">${chips}</div>
  </header>
  <main id="feed">${renderFeed(memos)}</main>
  <p class="none" id="none">Nothing matches.</p>
  <footer><a href="/__logout">Sign out</a></footer>
</div>
<script>
(() => {
  const entries = [...document.querySelectorAll(".entry")];
  const months = [...document.querySelectorAll(".month")];
  const chips = [...document.querySelectorAll(".chip")];
  const q = document.getElementById("q");
  const count = document.getElementById("count");
  const none = document.getElementById("none");
  // #e-<entry> (linked from the Habits app) opens that one entry; any other
  // hash is a filter chip.
  const target = location.hash.indexOf("#e-") === 0 ? document.getElementById(decodeURIComponent(location.hash.slice(1))) : null;
  let filter = target ? "all" : (location.hash.slice(1) || "all");
  if (!chips.some((c) => c.dataset.filter === filter)) filter = "all";

  function apply() {
    const term = q.value.trim().toLowerCase();
    let shown = 0, lastDay = null;
    for (const e of entries) {
      const ok = (filter === "all" || e.dataset.kind === filter) && (!term || e.dataset.search.includes(term));
      e.hidden = !ok;
      if (!ok) continue;
      shown++;
      // Only the first visible entry of a day shows its date on the spine.
      const day = e.querySelector(".num").textContent + e.querySelector(".dow").textContent + e.closest(".month").querySelector(".month-label").textContent;
      e.querySelectorAll(".num, .dow").forEach((el) => el.classList.toggle("same", day === lastDay));
      lastDay = day;
    }
    for (const m of months) m.classList.toggle("empty", !m.querySelector(".entry:not([hidden])"));
    chips.forEach((c) => c.setAttribute("aria-pressed", String(c.dataset.filter === filter)));
    chips.find((c) => c.dataset.filter === filter).scrollIntoView({ inline: "nearest", block: "nearest" });
    count.textContent = shown + (shown === 1 ? " entry" : " entries");
    none.classList.toggle("show", shown === 0);
  }
  chips.forEach((c) => c.addEventListener("click", () => {
    filter = c.dataset.filter;
    history.replaceState(null, "", filter === "all" ? location.pathname : "#" + filter);
    apply();
  }));
  q.addEventListener("input", apply);
  apply();
  if (target) {
    target.querySelector("details").open = true;
    target.classList.add("linked");
    target.scrollIntoView({ block: "start" });
  }
})();
</script>
</body>
</html>`;
}

function build() {
  const memos = loadMemos();
  KINDS = kindsOf(memos);
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, "index.html"), page(memos));
  // Icons + manifest (committed in static/, generated by make-icons.js).
  if (fs.existsSync(STATIC_DIR)) {
    for (const f of fs.readdirSync(STATIC_DIR)) fs.copyFileSync(path.join(STATIC_DIR, f), path.join(OUT_DIR, f));
  }
  const byKind = KINDS.map((k) => `${k} ${memos.filter((m) => m._kind === k).length}`).join(", ");
  console.log(`Built ${memos.length} entries (${byKind}) into ${OUT_DIR}`);
}

build();
