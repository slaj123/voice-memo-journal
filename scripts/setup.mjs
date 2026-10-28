// npm run setup: your journal categories, which routes are on, your private repo and time zone.
// Writes setup.json (your answers, git-ignored), worker/src/setup.js, the vars in
// worker/wrangler.toml, and the time zone in site/journal/config.json.
// `npm run setup -- --apply` skips the questions and applies setup.json as-is.
import { readFileSync, writeFileSync } from "node:fs";
import { APPLY_ONLY, loadSetup, saveSetup, ask, askList, askTimeZone, askYesNo, done } from "./lib/setup-kit.mjs";
import CURRENT from "../worker/src/setup.js";

const s = loadSetup("setup.json", {
  githubOwner: "", githubRepo: "my-voice-journal", timeZone: "", journal: CURRENT.journal,
  dailylog: true, workout: false, workoutUrl: "",
});

if (!APPLY_ONLY) {
  console.log("Voice Memo Journal setup. Press Enter to keep the value in [brackets].\n");
  s.githubOwner = await ask("Your GitHub username", s.githubOwner);
  s.githubRepo = await ask("Your PRIVATE repo's name (memos are committed there)", s.githubRepo);
  s.timeZone = await askTimeZone(s.timeZone);
  const names = await askList("Journal categories (the AI files each memo into one)", s.journal.map((c) => c.name));
  const next = [];
  for (const name of names) {
    const was = s.journal.find((c) => c.name === name)?.description || "";
    next.push({ name, description: await ask(`  One line on what goes in "${name}"`, was) });
  }
  s.journal = next;
  s.dailylog = await askYesNo("Turn on the Daily Log route (a catch-all for notes and errands)?", s.dailylog);
  s.workout = await askYesNo("Send workout memos to the Workout Log kit?", s.workout);
  if (s.workout) s.workoutUrl = await ask("  Your Workout Log URL (https://...)", s.workoutUrl);
  saveSetup("setup.json", s);
}
done();

if (!s.githubOwner || !s.githubRepo) { console.error("Setup needs your GitHub username and repo name."); process.exit(1); }
if (!s.journal.length) { console.error("Setup needs at least one journal category."); process.exit(1); }

writeFileSync("worker/src/setup.js",
  "// Your journal. Written by `npm run setup` or Claude Code's /setup, from setup.json.\n" +
  "// The AI files each memo into exactly one of these categories, guided by the description,\n" +
  "// so write descriptions the way you'd explain the category to a person.\n" +
  `export default ${JSON.stringify({ journal: s.journal }, null, 2)};\n`);
console.log("Wrote worker/src/setup.js.");

const enabled = ["journal", ...(s.dailylog ? ["dailylog"] : []), ...(s.workout ? ["workout"] : [])];
let toml = readFileSync("worker/wrangler.toml", "utf8")
  .replace(/^GITHUB_OWNER = ".*"$/m, `GITHUB_OWNER = "${s.githubOwner}"`)
  .replace(/^GITHUB_REPO = ".*"$/m, `GITHUB_REPO = "${s.githubRepo}"`);
toml = /^ENABLED_APPS = /m.test(toml)
  ? toml.replace(/^ENABLED_APPS = ".*"$/m, `ENABLED_APPS = "${enabled.join(",")}"`)
  : toml.replace(/^\[vars\]$/m, `[vars]\n# Which upload routes are on (/journal/upload, /dailylog/upload, /workout/upload).\nENABLED_APPS = "${enabled.join(",")}"`);
if (s.workout && s.workoutUrl) toml = toml.replace(/^WORKOUT_INGEST_URL = ".*"$/m, `WORKOUT_INGEST_URL = "${s.workoutUrl.replace(/\/+$/, "")}/api/ingest"`);
writeFileSync("worker/wrangler.toml", toml);
console.log(`Updated worker/wrangler.toml (repo ${s.githubOwner}/${s.githubRepo}, routes: ${enabled.join(", ")}).`);

const cfg = JSON.parse(readFileSync("site/journal/config.json", "utf8"));
cfg.timeZone = s.timeZone;
writeFileSync("site/journal/config.json", JSON.stringify(cfg, null, 2) + "\n");
console.log("Set the journal site's time zone.");

console.log("\nNext: follow README.md from \"Create a GitHub token\" (or ask Claude Code: /setup).");
console.log("Changing categories later: rerun `npm run setup`, then `cd worker && npx wrangler deploy`.");
