import assert from "node:assert";
import "./fixed-setup.js";
import worker from "../src/index.js";

const calls = [];
const originalFetch = global.fetch;

global.fetch = async (url, opts = {}) => {
  calls.push({ url: String(url), opts });

  if (url.includes("/audio/transcriptions")) {
    return {
      ok: true,
      json: async () => ({ text: "Test transcript about catching waves." }),
    };
  }
  if (url.includes("/chat/completions")) {
    // The prompt only mentions ratings/Activities for the legacy app;
    // use that to tell the mock which app's memo is being tagged.
    const body = JSON.parse(opts.body);
    const isJournal = !body.messages[0].content.includes("Only for Activities memos");
    const isWorkout = body.messages[0].content.includes('"exercises"');
    const isDailyLog = body.messages[0].content.includes("General catch-all");
    const content = isDailyLog
      ? '{"category": "Daily Log", "subcategory": "daily-summary", "headline": "Busy Friday", "summary": "Class, gym, tennis."}'
      : isWorkout
      ? '{"category": "Lifting (Pull)", "subcategory": "pull-day", "headline": "Pull day", "summary": "Rows.", "exercises": [{"name": "Seated Row", "sets": [{"reps": 12, "weight": 65, "unit": "lb"}]}]}'
      : isJournal
      ? '{"category": "Reflections", "subcategory": "Processing a Hard Week", "headline": "Working through it", "summary": "Sorting out some feelings."}'
      : '{"category": "Activities", "subcategory": "Surfing", "headline": "Caught some clean waves", "summary": "Caught some waves.", "ratings": [{"label": "Surf Quality", "score": 7.5}]}';
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content } }] }),
    };
  }
  if (url.includes("/contents/memos/workout")) {
    // Simulates the 2026-09 outage: an expired GitHub token.
    return { ok: false, status: 401, text: async () => '{"message":"Bad credentials"}' };
  }
  if (url.startsWith("https://habits.test/api/ingest/dailylog")) {
    return { ok: true, status: 204, text: async () => "" };
  }
  if (url.startsWith("https://habits-down.test/")) {
    return { ok: false, status: 503, text: async () => "down" };
  }
  if (url.includes("/contents/memos/dailylog?")) {
    return { ok: true, status: 200, json: async () => [{ name: "2026-10-08-0632-daily-log-daily-summary.json" }] };
  }
  if (url.startsWith("https://workout.test/api/ingest")) {
    return { ok: true, status: 201, text: async () => '{"id":"abc"}' };
  }
  if (url.includes("/contents/memos/journal?")) {
    return {
      ok: true,
      status: 200,
      json: async () => [{ name: "2026-08-22-2145-reflections-processing-a-hard-week.json" }],
    };
  }
  if (url.includes("/contents/memos?")) {
    return {
      ok: true,
      status: 200,
      json: async () => [{ name: "2026-08-20-1430-activities-surfing.json" }],
    };
  }
  if (opts.method === "PUT" && url.includes("/contents/memos/journal/")) {
    return { ok: true, json: async () => ({ content: { path: "memos/journal/x.json" } }) };
  }
  if (opts.method === "PUT" && url.includes("/contents/memos/")) {
    return { ok: true, json: async () => ({ content: { path: "memos/x.json" } }) };
  }
  throw new Error(`Unmocked fetch call: ${url}`);
};

async function run() {
  const audioBlob = new Blob([new Uint8Array([1, 2, 3])], { type: "audio/m4a" });
  const form = new FormData();
  form.append("audio", audioBlob, "memo.m4a");

  const request = {
    method: "POST",
    url: "https://worker.example.com/upload",
    headers: new Map([["X-Upload-Secret", "test-shared-secret"]]),
    formData: async () => form,
  };
  request.headers.get = Map.prototype.get.bind(request.headers);

  const r2Puts = [];
  const r2Objects = new Map();
  const env = {
    OPENAI_API_KEY: "test-key",
    GITHUB_TOKEN: "test-token",
    GITHUB_OWNER: "testuser",
    GITHUB_REPO: "voice-memo-logger",
    GITHUB_BRANCH: "main",
    MEMOS_PATH: "memos",
    UPLOAD_SECRET: "test-shared-secret",
    MEMOS_AUDIO: {
      put: async (key, body, opts) => {
        r2Puts.push({ key, body, opts });
        r2Objects.set(key, { body, httpMetadata: opts?.httpMetadata });
        return {};
      },
      get: async (key) => r2Objects.get(key) || null,
    },
  };

  const backgroundTasks = [];
  const ctx = { waitUntil: (p) => backgroundTasks.push(p) };

  const res = await worker.fetch(request, env, ctx);
  const body = await res.json();

  assert.strictEqual(res.status, 202);
  assert.strictEqual(body.status, "queued");

  // The response is returned before background work starts; wait for it
  // here so the test can assert on its side effects (the GitHub commit).
  await Promise.all(backgroundTasks);

  const putCall = calls.find((c) => c.opts.method === "PUT");
  assert.ok(putCall, "expected a PUT commit call to GitHub");
  const committedBody = JSON.parse(putCall.opts.body);
  const decoded = JSON.parse(Buffer.from(committedBody.content, "base64").toString("utf8"));
  assert.strictEqual(decoded.category, "Activities");
  assert.strictEqual(decoded.subcategory, "Surfing");
  assert.deepStrictEqual(decoded.ratings, [{ label: "Surf Quality", score: 7.5 }]);
  assert.strictEqual(decoded.recordedOn, undefined, "no recordedAt sent, so no recordedOn");

  // Audio should be stored in R2 (derived key matching the JSON filename
  // base, with the uploaded file's own extension) and referenced from the
  // committed memo record.
  assert.strictEqual(r2Puts.length, 1, "expected one R2 put call for the audio");
  assert.ok(r2Puts[0].key.endsWith(".m4a"), `expected .m4a key, got ${r2Puts[0].key}`);
  assert.strictEqual(decoded.audioKey, r2Puts[0].key);

  // Audio is no longer public: GET /audio/:key is gone even for a real key.
  // It plays only through the passcode-gated Journal site.
  const audioGetRequest = { method: "GET", url: `https://worker.example.com/audio/${decoded.audioKey}` };
  const audioGetRes = await worker.fetch(audioGetRequest, env, ctx);
  assert.strictEqual(audioGetRes.status, 410);

  // Wrong/missing secret must be rejected before any upstream calls happen.
  const callsBeforeUnauthorized = calls.length;
  const unauthorizedRequest = {
    method: "POST",
    url: "https://worker.example.com/upload",
    headers: new Map([["X-Upload-Secret", "wrong-secret"]]),
    formData: async () => form,
  };
  unauthorizedRequest.headers.get = Map.prototype.get.bind(unauthorizedRequest.headers);

  const unauthorizedRes = await worker.fetch(unauthorizedRequest, env, ctx);
  assert.strictEqual(unauthorizedRes.status, 401);
  assert.strictEqual(calls.length, callsBeforeUnauthorized, "no upstream calls should happen for an unauthorized request");

  // /upload-transcript: pre-transcribed text (e.g. from local Whisper on a
  // huge file) skips the Whisper call entirely but still summarizes, tags,
  // and commits like the normal flow.
  // Two days ago, so the recordedAt sanity window always accepts it.
  const recordedDay = new Date(Date.now() - 2 * 86400e3).toISOString().slice(0, 10);
  const transcriptRequest = {
    method: "POST",
    url: "https://worker.example.com/upload-transcript",
    headers: new Map([["X-Upload-Secret", "test-shared-secret"]]),
    json: async () => ({ transcript: "A long locally-transcribed memo about waves.", recordedAt: recordedDay }),
  };
  transcriptRequest.headers.get = Map.prototype.get.bind(transcriptRequest.headers);

  const callsBeforeTranscriptUpload = calls.length;
  const transcriptBackgroundTasks = [];
  const transcriptCtx = { waitUntil: (p) => transcriptBackgroundTasks.push(p) };

  const transcriptRes = await worker.fetch(transcriptRequest, env, transcriptCtx);
  const transcriptResBody = await transcriptRes.json();

  assert.strictEqual(transcriptRes.status, 202);
  assert.strictEqual(transcriptResBody.status, "queued");

  await Promise.all(transcriptBackgroundTasks);

  const callsAfterTranscriptUpload = calls.slice(callsBeforeTranscriptUpload);
  assert.ok(
    !callsAfterTranscriptUpload.some((c) => c.url.includes("/audio/transcriptions")),
    "/upload-transcript must not call the Whisper API"
  );
  const transcriptPutCall = callsAfterTranscriptUpload.find((c) => c.opts.method === "PUT");
  assert.ok(transcriptPutCall, "expected a PUT commit call to GitHub for /upload-transcript");
  const transcriptCommittedBody = JSON.parse(transcriptPutCall.opts.body);
  const transcriptDecoded = JSON.parse(
    Buffer.from(transcriptCommittedBody.content, "base64").toString("utf8")
  );
  assert.strictEqual(transcriptDecoded.transcript, "A long locally-transcribed memo about waves.");
  assert.strictEqual(transcriptDecoded.recordedOn, recordedDay);

  // /journal/upload-transcript: routes to the journal app — commits under
  // memos/journal/ instead of memos/, and only allows journal's category set.
  const journalRequest = {
    method: "POST",
    url: "https://worker.example.com/journal/upload-transcript",
    headers: new Map([["X-Upload-Secret", "test-shared-secret"]]),
    json: async () => ({ transcript: "Processing some feelings tonight." }),
  };
  journalRequest.headers.get = Map.prototype.get.bind(journalRequest.headers);

  const callsBeforeJournal = calls.length;
  const journalBackgroundTasks = [];
  const journalCtx = { waitUntil: (p) => journalBackgroundTasks.push(p) };

  const journalRes = await worker.fetch(journalRequest, env, journalCtx);
  assert.strictEqual(journalRes.status, 202);

  await Promise.all(journalBackgroundTasks);

  const callsAfterJournal = calls.slice(callsBeforeJournal);
  const journalListCall = callsAfterJournal.find((c) => c.url.includes("/contents/memos/journal?"));
  assert.ok(journalListCall, "expected the journal app to list memos/journal, not memos/");

  const journalPutCall = callsAfterJournal.find((c) => c.opts.method === "PUT");
  assert.ok(journalPutCall, "expected a PUT commit call to GitHub for /journal/upload-transcript");
  assert.ok(journalPutCall.url.includes("/contents/memos/journal/"), "journal memo should commit under memos/journal/");
  const journalDecoded = JSON.parse(
    Buffer.from(JSON.parse(journalPutCall.opts.body).content, "base64").toString("utf8")
  );
  assert.strictEqual(journalDecoded.category, "Reflections");

  // /workout/upload-transcript: delivered to the Workout Log app's ingest,
  // not GitHub, and still delivered when GitHub reads fail.
  const workoutEnv = { ...env, WORKOUT_INGEST_URL: "https://workout.test/api/ingest", WORKOUT_INGEST_SECRET: "ingest-secret" };
  const workoutRequest = {
    method: "POST",
    url: "https://worker.example.com/workout/upload-transcript",
    headers: new Map([["X-Upload-Secret", "test-shared-secret"]]),
    json: async () => ({ transcript: "Pull day, seated rows 65 for 12.", recordedAt: recordedDay }),
  };
  workoutRequest.headers.get = Map.prototype.get.bind(workoutRequest.headers);
  const callsBeforeWorkout = calls.length;
  const workoutTasks = [];
  const workoutRes = await worker.fetch(workoutRequest, workoutEnv, { waitUntil: (p) => workoutTasks.push(p) });
  assert.strictEqual(workoutRes.status, 202);
  await Promise.all(workoutTasks);
  const workoutCalls = calls.slice(callsBeforeWorkout);
  assert.ok(!workoutCalls.some((c) => c.opts.method === "PUT"), "workout memos must not be committed to GitHub");
  const ingestCall = workoutCalls.find((c) => c.url.startsWith("https://workout.test/api/ingest"));
  assert.ok(ingestCall, "expected the workout memo to be POSTed to the ingest URL");
  assert.strictEqual(ingestCall.opts.headers["X-Ingest-Secret"], "ingest-secret");
  const ingested = JSON.parse(ingestCall.opts.body);
  assert.strictEqual(ingested.source, "voice");
  assert.strictEqual(ingested.memo.category, "Lifting (Pull)");
  assert.strictEqual(ingested.memo.recordedOn, recordedDay);
  assert.strictEqual(ingested.memo.exercises[0].sets[0].weight, 65);

  // /dailylog/upload-transcript: committed to GitHub first, then Habits is
  // told the entry's name (so it can link to it) with the shared secret.
  const dailyEnv = { ...env, HABITS_INGEST_URL: "https://habits.test/api/ingest/dailylog", HABITS_INGEST_SECRET: "habits-secret" };
  const dailyRequest = (e) => {
    const r = {
      method: "POST",
      url: "https://worker.example.com/dailylog/upload-transcript",
      headers: new Map([["X-Upload-Secret", "test-shared-secret"]]),
      json: async () => ({ transcript: "Quick daily log for Friday." }),
    };
    r.headers.get = Map.prototype.get.bind(r.headers);
    return r;
  };
  let before = calls.length;
  let tasks = [];
  assert.strictEqual((await worker.fetch(dailyRequest(), dailyEnv, { waitUntil: (p) => tasks.push(p) })).status, 202);
  await Promise.all(tasks);
  let dailyCalls = calls.slice(before);
  const dailyPutIdx = dailyCalls.findIndex((c) => c.opts.method === "PUT" && c.url.includes("/contents/memos/dailylog/"));
  const habitsIdx = dailyCalls.findIndex((c) => c.url.startsWith("https://habits.test/api/ingest/dailylog"));
  assert.ok(dailyPutIdx >= 0, "daily log memo should commit under memos/dailylog/");
  assert.ok(habitsIdx > dailyPutIdx, "Habits is told only after the commit");
  const habitsCall = dailyCalls[habitsIdx];
  assert.strictEqual(habitsCall.opts.headers["X-Ingest-Secret"], "habits-secret");
  const ping = JSON.parse(habitsCall.opts.body);
  const committedName = dailyCalls[dailyPutIdx].url.split("/").pop();
  assert.strictEqual(ping.entry + ".json", committedName, "entry is the committed file's name");
  assert.strictEqual(ping.headline, "Busy Friday");
  assert.ok(!Number.isNaN(Date.parse(ping.at)));

  // Journal memos never ping Habits.
  assert.ok(!calls.slice(callsBeforeJournal, before).some((c) => c.url.includes("habits")), "only daily logs ping Habits");

  // Habits down: the memo is still committed and the job doesn't fail.
  before = calls.length;
  tasks = [];
  const downEnv = { ...dailyEnv, HABITS_INGEST_URL: "https://habits-down.test/api/ingest/dailylog" };
  await worker.fetch(dailyRequest(), downEnv, { waitUntil: (p) => tasks.push(p) });
  await Promise.all(tasks);
  dailyCalls = calls.slice(before);
  assert.ok(dailyCalls.some((c) => c.opts.method === "PUT" && c.url.includes("/contents/memos/dailylog/")));
  assert.ok(dailyCalls.some((c) => c.url.startsWith("https://habits-down.test/")));

  // With the HABITS service binding, the ping goes through it, not global fetch.
  const viaBinding = [];
  const boundEnv = { ...dailyEnv, HABITS: { fetch: async (req) => { viaBinding.push({ url: req.url, secret: req.headers.get("X-Ingest-Secret"), body: await req.text() }); return new Response(null, { status: 204 }); } } };
  before = calls.length;
  tasks = [];
  await worker.fetch(dailyRequest(), boundEnv, { waitUntil: (p) => tasks.push(p) });
  await Promise.all(tasks);
  assert.strictEqual(viaBinding.length, 1, "ping should use the service binding");
  assert.strictEqual(viaBinding[0].url, "https://habits.test/api/ingest/dailylog");
  assert.strictEqual(viaBinding[0].secret, "habits-secret");
  assert.ok(!calls.slice(before).some((c) => c.url.startsWith("https://habits.test")), "no global fetch to Habits when bound");

  console.log("index.test.js: all assertions passed");
}

run()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    global.fetch = originalFetch;
  });
