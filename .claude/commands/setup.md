---
description: Set up your private voice journal end to end
---

Walk the person through setting up their own Voice Memo Journal. One step at a time, say what each step does in one plain sentence, and wait for them before moving on. Define technical words the first time.

1. **Privacy first.** Check `git remote -v`. Their repo must be a **private** repo they own, made with "Use this template", not a fork; memos are committed to it. If it's public or a fork, stop and help them fix that first.

2. **Check tools.** `node --version` (20 or newer). Run `npm install` in `worker/` if `worker/node_modules/` is missing.

3. **Interview them**, one question at a time:
   - Their GitHub username and the private repo's name.
   - Their time zone (turn a city into an IANA name for them).
   - Their journal categories. Suggest a few (for example Reflections, Ideas, Gratitude). For each, write a one-line description together; the AI uses it to sort memos.
   - Whether to turn on the Daily Log route (a catch-all for notes and errands).
   - Whether to send workout memos to the Workout Log kit, and its URL if so.

4. **Write `setup.json`**:
   ```json
   { "githubOwner": "", "githubRepo": "", "timeZone": "",
     "journal": [{ "name": "", "description": "" }],
     "dailylog": true, "workout": false, "workoutUrl": "" }
   ```
   Confirm it with them, then run `npm run setup -- --apply`. Commit and push the changed `worker/src/setup.js`, `worker/wrangler.toml` and `site/journal/config.json`. They're preferences, not secrets.

5. **Then follow README.md in order.** Explain each step and let them type every secret themselves:
   - Step 2: the GitHub token (fine-grained, this repo only, Contents read and write).
   - Step 3: the R2 bucket, the three Worker secrets, and `npx wrangler deploy` in `worker/`.
   - Step 4: the KV namespace, the Pages project (root `site/journal`, build `node generate.js`, output `dist`), the two Pages secrets, then a fresh deployment. Pages only picks up secrets on a new deployment.
   - Step 5: the iOS Shortcut, one per route they turned on.

6. **Test it:** share one short voice memo through the Shortcut, wait a minute, and open the journal site.

End with three lines: the journal URL, how to change categories later (rerun `npm run setup`, then `cd worker && npx wrangler deploy`), and the first thing to check if uploads stop (an expired GitHub token).
