# Voice Memo Journal

Turn iPhone voice memos into a private, searchable journal. Share a memo from the Voice Memos app, and a few seconds later it's transcribed, summarized, tagged with a category and filed on your own password-protected journal site, with the audio playable next to the text.

```
iPhone Voice Memo
  → Share → iOS Shortcut → POST the audio to your Cloudflare Worker
  → Worker (in the background):
      1. checks the upload secret
      2. transcribes with OpenAI Whisper
      3. writes a headline + summary and picks a category with GPT-4o-mini
      4. saves the audio to R2 and commits a JSON entry to memos/ in YOUR private GitHub repo
  → Cloudflare Pages rebuilds the journal site from that repo
  → You read it at your own URL, behind a passcode
```

Several "apps" share one Worker, each with its own route and categories (see `worker/src/apps.js`):

| Route | Goes to | Categories |
| --- | --- | --- |
| `/journal/upload` | `memos/journal/`, shown on the journal site | Yours, chosen in setup (default: Reflections, Thoughts, Daily Reflections) |
| `/dailylog/upload` | `memos/dailylog/`, shown on the same site under Daily Log | Daily Log (catch-all) |
| `/workout/upload` | Sent to the [workout-log](https://github.com/slaj123/workout-log) kit, if you use it | One per activity |

You choose the journal categories and which routes are on in `npm run setup` (step 1). The model only picks from your list, guided by a one-line description of each.

## Important: keep your copy private

Your memos are committed to the GitHub repo the Worker points at, so **that repo must be private**. Don't click "Fork" (forks of a public repo are public). Instead:

1. Click **Use this template → Create a new repository** (or clone this repo and push it to a new repo).
2. Set the new repo's visibility to **Private**.

## What you need

- [Node.js](https://nodejs.org) 20 or newer
- A free [Cloudflare](https://dash.cloudflare.com/sign-up) account (Workers, Pages, R2 and KV are all on the free plan; R2 asks for a card on file)
- An [OpenAI API key](https://platform.openai.com/api-keys). Transcription costs about $0.006 per minute of audio.
- A GitHub account, and an iPhone with the Shortcuts app

## 1. Make your private repo

Follow "Keep your copy private" above, then clone your new private repo:

```bash
git clone https://github.com/<your-username>/<your-private-repo>.git
cd <your-private-repo>
```

**Make it yours:**

```bash
cd worker && npm install && cd ..
npm run setup
```

It asks:
- your GitHub username and the private repo's name;
- your time zone;
- your journal categories, each with a one-line description the AI uses to sort memos;
- whether to turn on the Daily Log route;
- whether to send workout memos to the Workout Log kit.

It writes `worker/src/setup.js`, the vars in `worker/wrangler.toml` and the site's time zone. Your answers are kept in `setup.json` (git-ignored). Commit and push the other changes, which are preferences, not secrets.

**Change categories later:** rerun `npm run setup`, then redeploy the Worker (`cd worker && npx wrangler deploy`). New chips show up on the site by themselves.

**Set up with Claude Code:** open this folder in [Claude Code](https://claude.com/claude-code) and type `/setup`. It checks that your repo is private, helps you write your categories, and walks you through every step below.

## 2. Create a GitHub token for the Worker

The Worker commits memos using a token that can only write to this one repo.

1. GitHub → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. **Repository access:** Only select repositories, then pick your private repo.
3. **Permissions → Contents:** Read and write.
4. Generate it and copy the token. You'll paste it in step 3.

Fine-grained tokens expire. When uploads start failing, the expired token is the first thing to check.

## 3. Deploy the Worker

```bash
cd worker
npm install
npm test
npx wrangler login
npx wrangler r2 bucket create voice-journal-audio
```

(`npm run setup` already put your username and repo name into `worker/wrangler.toml`.)

Set the secrets. Each command asks you to paste a value:

```bash
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put GITHUB_TOKEN
npx wrangler secret put UPLOAD_SECRET
```

`UPLOAD_SECRET` is a long random string you make up. Your Shortcut sends it with every upload. To generate one:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Then deploy:

```bash
npx wrangler deploy
```

It prints the Worker URL, something like `https://voice-memo-journal.<your-subdomain>.workers.dev`.

## 4. Build the journal site (Cloudflare Pages)

1. Create the KV namespace that counts wrong passcode tries:
   ```bash
   npx wrangler kv namespace create AUTH_KV
   ```
   Paste the id it prints into `site/journal/wrangler.toml`, replacing `REPLACE_WITH_KV_NAMESPACE_ID`. Commit and push.
2. In the Cloudflare dashboard, go to **Workers & Pages → Create → Pages → Connect to Git**. Pick your private repo, then set:
   - Project name: `voice-journal`
   - Root directory: `site/journal`
   - Build command: `node generate.js`
   - Build output directory: `dist`
3. Set the site's two secrets:
   ```bash
   npx wrangler pages secret put JOURNAL_PASSCODE --project-name voice-journal
   npx wrangler pages secret put SESSION_SECRET --project-name voice-journal
   ```
   The passcode must be 12 or more characters. `SESSION_SECRET` must be 32 or more random characters.
4. **Redeploy after setting secrets.** Pages takes a snapshot of secrets at each deployment, so the first build won't see them. In the dashboard, open the project's **Deployments** tab and choose **Retry deployment**.

The site is locked with that passcode. A correct passcode keeps the device signed in for a year. Five wrong tries from one IP locks it out for a while. If the secrets are missing, the site refuses to load instead of opening unlocked.

On iPhone, open the site in Safari and use **Share → Add to Home Screen**.

## 5. Make the iOS Shortcut

Make one Shortcut per app you use: Journal, Daily Log, or Workout.

1. Open Shortcuts, create a new Shortcut, and in its settings turn on **Show in Share Sheet**, accepting **Files** and **Media**.
2. Optional, but it dates memos by when you recorded them: add **Get Details of Files** (Creation Date of Shortcut Input), then **Format Date** (ISO 8601).
3. Add **Get Contents of URL**:
   - URL: `https://<your-worker-url>/journal/upload` (or `/dailylog/upload`, `/workout/upload`)
   - Method: **POST**
   - Headers: `X-Upload-Secret` = your `UPLOAD_SECRET`
   - Request Body: **Form**, with a field `audio` (type **File**, value **Shortcut Input**), and optionally a field `recordedAt` (type **Text**, value the formatted date).
4. Name it, for example "Log to Journal".

To use it, open a recording in Voice Memos, tap **Share**, then pick your Shortcut. The Worker replies right away and processes the memo in the background. The entry appears on your site once Pages finishes rebuilding, usually within a minute or two.

## Optional: connect the companion kits

- **Workout Log:** set `WORKOUT_INGEST_URL` in `worker/wrangler.toml` to your Workout Log's `/api/ingest` URL, and `npx wrangler secret put WORKOUT_INGEST_SECRET` to the same value as that app's `INGEST_SECRET`.
- **Habits:** set `HABITS_INGEST_URL` to your Habits app's `/api/ingest/dailylog` URL, run `npx wrangler secret put HABITS_INGEST_SECRET` with the same value as Habits' `DAILYLOG_INGEST_SECRET`, and uncomment the `[[services]]` block in `worker/wrangler.toml`.

If you don't set these up, everything else still works.

## Very long recordings (over 25 MB)

OpenAI's transcription API rejects files over 25 MB. For those, transcribe on your computer and send just the text:

```bash
pip install faster-whisper
cp scripts/config.example.json scripts/config.json
```

Edit `scripts/config.json` with your Worker URL and `UPLOAD_SECRET`. It is git-ignored. Then save big memos to a folder (for example a synced cloud folder) and run:

```bash
python scripts/transcribe_large_memo.py "C:\path\to\big-memos" --model medium --app journal
```

Each file is transcribed locally, sent to `/<app>/upload-transcript`, and moved into an `archived/` subfolder. Files that fail stay in place, and the next run retries them.

## Preview the site locally

```bash
cd site/journal
node generate.js
npx http-server dist
```

It builds from whatever is in `memos/journal/` and `memos/dailylog/`. This repo ships with those folders empty.

## Tests

```bash
npm test
```

Everything is mocked, so the tests need no network access or keys.

## License

MIT. See `LICENSE`.
