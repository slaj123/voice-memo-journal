# Voice Memo Journal: notes for Claude Code

iPhone voice memos become a private journal. An iOS Shortcut posts audio to a Cloudflare Worker (`worker/`). The Worker transcribes it (OpenAI Whisper), files it into a category (GPT-4o-mini), stores the audio in R2, and commits a JSON memo to the person's **private** GitHub repo. Cloudflare Pages then rebuilds the passcode-locked journal site (`site/journal/`). See README.md.

## If the person wants to set it up

Run the `/setup` command (`.claude/commands/setup.md`). Assume they may never have used a terminal. Explain each step in one line before running it. The most important thing: their copy of this repo must be **private**, because their memos get committed to it.

## Where personal choices live

- `worker/src/setup.js` (from `setup.json`): journal categories and their one-line descriptions. The descriptions steer the AI, so help them write descriptions a person would understand.
- `worker/wrangler.toml` `[vars]`: `GITHUB_OWNER`, `GITHUB_REPO`, `ENABLED_APPS` (which upload routes are on), `WORKOUT_INGEST_URL`, `HABITS_INGEST_URL`.
- `site/journal/config.json`: the site's time zone. The site's filter chips come from the memos themselves, so no other site config is needed.
- Secrets: `OPENAI_API_KEY`, `GITHUB_TOKEN`, `UPLOAD_SECRET` (Worker), and `JOURNAL_PASSCODE`, `SESSION_SECRET` (Pages). Use `wrangler secret put` or `wrangler pages secret put`. Never commit them or repeat them in chat.
- There's no in-app settings screen: the journal is a static site. Changing categories means rerunning `npm run setup` and redeploying the Worker.

## Checks before calling anything done

- `npm test` at the root (runs `worker/` tests plus the site's audio test; everything is mocked, no keys needed). Tests pin their own categories via `worker/test/fixed-setup.js`.
- `cd site/journal && node generate.js` builds the site from `memos/`.
