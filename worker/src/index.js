import {
  buildFilename,
  subcategoriesFromFilenames,
  buildCategoryPrompt,
  parseCategoryResponse,
  buildMemoRecord,
  parseRecordedOn,
} from "./lib.js";
import { APPS } from "./apps.js";

async function transcribeAudio(audioBlob, filename, apiKey) {
  const form = new FormData();
  form.append("file", audioBlob, filename);
  form.append("model", "whisper-1");

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!res.ok) throw new Error(`Whisper API error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.text;
}

async function summarizeAndTag(transcript, knownSubcategoriesByCategory, knownCategories, apiKey, appConfig) {
  const prompt = buildCategoryPrompt(
    transcript,
    knownSubcategoriesByCategory,
    knownCategories,
    appConfig.categoryDescriptions,
    appConfig.extraPromptNotes,
    appConfig.extractExercises,
    appConfig.openCategories
  );
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) throw new Error(`Chat API error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return parseCategoryResponse(data.choices[0].message.content, knownCategories, {
    extractExercises: appConfig.extractExercises,
    openCategories: appConfig.openCategories,
  });
}

function memosPath(env, appConfig) {
  return appConfig.memosPath ? `${env.MEMOS_PATH}/${appConfig.memosPath}` : env.MEMOS_PATH;
}

async function listMemoFilenames(env, appConfig) {
  const url = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${memosPath(env, appConfig)}?ref=${env.GITHUB_BRANCH}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      "User-Agent": "voice-memo-logger-worker",
      Accept: "application/vnd.github+json",
    },
  });
  if (res.status === 404) return []; // memos folder doesn't exist yet
  if (!res.ok) throw new Error(`GitHub list error ${res.status}: ${await res.text()}`);
  const entries = await res.json();
  return entries.map((e) => e.name);
}

// Apps with `openCategories: true` (currently just Workout Logger) treat
// their category list as open-ended: `appConfig.categories` is only the
// seed set. `memos/<app>/categories.json` in the repo tracks every category
// the model has ever proposed, so it stays "known" (and doesn't get
// re-proposed slightly differently) across Worker invocations.
async function categoriesManifestUrl(env, appConfig) {
  return `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${memosPath(env, appConfig)}/categories.json?ref=${env.GITHUB_BRANCH}`;
}

async function loadKnownCategories(env, appConfig) {
  if (!appConfig.openCategories) return appConfig.categories;
  const res = await fetch(await categoriesManifestUrl(env, appConfig), {
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      "User-Agent": "voice-memo-logger-worker",
      Accept: "application/vnd.github+json",
    },
  });
  if (res.status === 404) return appConfig.categories; // manifest doesn't exist yet
  if (!res.ok) throw new Error(`GitHub categories.json read error ${res.status}: ${await res.text()}`);
  const entry = await res.json();
  const decoded = atob(entry.content.replace(/\n/g, ""));
  const stored = JSON.parse(decoded);
  return [...new Set([...appConfig.categories, ...stored])];
}

async function recordNewCategory(env, appConfig, knownCategories, category) {
  if (!appConfig.openCategories || knownCategories.includes(category)) return;
  const updated = [...knownCategories, category].sort();
  const url = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${memosPath(env, appConfig)}/categories.json`;
  const getRes = await fetch(`${url}?ref=${env.GITHUB_BRANCH}`, {
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      "User-Agent": "voice-memo-logger-worker",
      Accept: "application/vnd.github+json",
    },
  });
  const sha = getRes.ok ? (await getRes.json()).sha : undefined;
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      "User-Agent": "voice-memo-logger-worker",
      Accept: "application/vnd.github+json",
    },
    body: JSON.stringify({
      message: `Add new Workout Logger category: ${category}`,
      content: toBase64(JSON.stringify(updated, null, 2)),
      branch: env.GITHUB_BRANCH,
      ...(sha ? { sha } : {}),
    }),
  });
  if (!res.ok) throw new Error(`GitHub categories.json write error ${res.status}: ${await res.text()}`);
}

function toBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

async function commitMemoFile(env, appConfig, filename, memoRecord) {
  const url = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${memosPath(env, appConfig)}/${filename}`;
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      "User-Agent": "voice-memo-logger-worker",
      Accept: "application/vnd.github+json",
    },
    body: JSON.stringify({
      message: `Add memo: ${memoRecord.category} / ${memoRecord.subcategory} (${memoRecord.date})`,
      content: toBase64(JSON.stringify(memoRecord, null, 2)),
      branch: env.GITHUB_BRANCH,
    }),
  });
  if (!res.ok) throw new Error(`GitHub commit error ${res.status}: ${await res.text()}`);
  return res.json();
}

function timingSafeEqual(a, b) {
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) diff |= aBytes[i] ^ bBytes[i];
  return diff === 0;
}

async function storeAudio(audio, filenameBase, env) {
  const ext = (audio.name || "memo.m4a").split(".").pop() || "m4a";
  const key = `${filenameBase}.${ext}`;
  await env.MEMOS_AUDIO.put(key, await audio.arrayBuffer(), {
    httpMetadata: { contentType: audio.type || "audio/mp4" },
  });
  return key;
}

async function processTranscript(transcript, env, appConfig, audio, recordedOn) {
  const date = new Date().toISOString();

  // Ingest apps don't store memos in GitHub anymore, so the repo is only a
  // hint source for known subcategories/categories. A GitHub outage (e.g. an
  // expired token) must not lose the memo: fall back to the seed lists.
  const hint = (p, fallback) => (appConfig.deliverToIngest ? p.catch((err) => {
    console.error("GitHub hint read failed, using seeds:", err.message);
    return fallback;
  }) : p);
  const [existingFilenames, knownCategories] = await Promise.all([
    hint(listMemoFilenames(env, appConfig), []),
    hint(loadKnownCategories(env, appConfig), appConfig.categories),
  ]);
  const knownSubcategoriesByCategory = Object.fromEntries(
    knownCategories.map((category) => [category, subcategoriesFromFilenames(existingFilenames, category)])
  );

  const { category, subcategory, headline, summary, ratings, exercises } = await summarizeAndTag(
    transcript,
    knownSubcategoriesByCategory,
    knownCategories,
    env.OPENAI_API_KEY,
    appConfig
  );
  if (!appConfig.deliverToIngest) await recordNewCategory(env, appConfig, knownCategories, category);
  const filename = buildFilename(date, category, subcategory);

  let audioKey;
  if (audio) {
    const filenameBase = filename.slice(0, -".json".length);
    audioKey = await storeAudio(audio, filenameBase, env);
  }

  const memoRecord = buildMemoRecord({
    date,
    recordedOn,
    category,
    subcategory,
    headline,
    summary,
    transcript,
    ratings,
    exercises,
    audioKey,
    reserveWatchField: appConfig.reserveWatchField,
  });

  if (appConfig.deliverToIngest) await deliverToIngest(env, memoRecord);
  else await commitMemoFile(env, appConfig, filename, memoRecord);
  // Only after the commit: Habits links to the Journal entry, so the memo
  // must exist first. A Habits hiccup must not fail an already-saved memo.
  if (appConfig.notifyHabits) {
    await notifyHabits(env, filename.slice(0, -".json".length), memoRecord).catch((err) => {
      console.error("Habits notify failed:", err.message);
    });
  }
}

// Tells the Habits app (../habits) a Daily Log was recorded, so its Daily Log
// row counts as done and links to this entry on the Journal site.
async function notifyHabits(env, entry, memoRecord) {
  if (!env.HABITS_INGEST_URL || !env.HABITS_INGEST_SECRET) throw new Error("habits ingest not configured");
  // Through the HABITS service binding when present: Cloudflare blocks a
  // Worker from fetching another *.workers.dev Worker on the same account.
  const send = env.HABITS ? (u, o) => env.HABITS.fetch(new Request(u, o)) : fetch;
  const res = await send(env.HABITS_INGEST_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Ingest-Secret": env.HABITS_INGEST_SECRET },
    body: JSON.stringify({ entry, at: memoRecord.date, headline: memoRecord.headline }),
  });
  if (!res.ok) throw new Error(`Habits ingest error ${res.status}: ${await res.text()}`);
}

// Hands a finished workout memo to the Workout Log app, which stores it as a
// "voice" session flagged for details.
async function deliverToIngest(env, memoRecord) {
  if (!env.WORKOUT_INGEST_URL || !env.WORKOUT_INGEST_SECRET) throw new Error("workout ingest not configured");
  const res = await fetch(env.WORKOUT_INGEST_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Ingest-Secret": env.WORKOUT_INGEST_SECRET },
    body: JSON.stringify({ source: "voice", memo: memoRecord }),
  });
  if (!res.ok) throw new Error(`Workout ingest error ${res.status}: ${await res.text()}`);
}

async function processMemo(audio, env, appConfig, recordedOn) {
  const transcript = await transcribeAudio(audio, audio.name || "memo.m4a", env.OPENAI_API_KEY);
  await processTranscript(transcript, env, appConfig, audio, recordedOn);
}

async function handleUpload(request, env, ctx, appConfig) {
  const providedSecret = request.headers.get("X-Upload-Secret") || "";
  if (!env.UPLOAD_SECRET || !timingSafeEqual(providedSecret, env.UPLOAD_SECRET)) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const form = await request.formData();
  const audio = form.get("audio");
  if (!audio || typeof audio === "string") {
    return new Response(JSON.stringify({ error: "missing 'audio' file field" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Optional: the day the memo was recorded (see parseRecordedOn).
  const recordedOn = parseRecordedOn(form.get("recordedAt"));

  // Respond immediately so the caller (an iOS Shortcut with a short network
  // timeout) doesn't wait on Whisper transcription + summarization + a
  // GitHub commit, which can take well over a minute for a multi-minute
  // memo. The rest of the work continues after the response is sent.
  ctx.waitUntil(
    processMemo(audio, env, appConfig, recordedOn).catch((err) => {
      console.error("processMemo failed:", err.message);
    })
  );

  return new Response(JSON.stringify({ status: "queued" }), {
    status: 202,
    headers: { "Content-Type": "application/json" },
  });
}

async function handleTranscriptUpload(request, env, ctx, appConfig) {
  const providedSecret = request.headers.get("X-Upload-Secret") || "";
  if (!env.UPLOAD_SECRET || !timingSafeEqual(providedSecret, env.UPLOAD_SECRET)) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const body = await request.json().catch(() => null);
  const transcript = body && typeof body.transcript === "string" ? body.transcript.trim() : "";
  if (!transcript) {
    return new Response(JSON.stringify({ error: "missing 'transcript' string field" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  ctx.waitUntil(
    processTranscript(transcript, env, appConfig, undefined, parseRecordedOn(body.recordedAt)).catch((err) => {
      console.error("processTranscript failed:", err.message);
    })
  );

  return new Response(JSON.stringify({ status: "queued" }), {
    status: 202,
    headers: { "Content-Type": "application/json" },
  });
}

// Un-prefixed /upload(-transcript) routes to the legacy app; /<app>/upload
// routes (e.g. /journal/upload) route to that named app in APPS.
// ENABLED_APPS (wrangler.toml var, e.g. "journal,dailylog") turns routes on; unset means all.
function resolveApp(pathname, env) {
  const on = (name) => !env.ENABLED_APPS || env.ENABLED_APPS.split(",").map((s) => s.trim()).includes(name);
  if (pathname === "/upload" || pathname === "/upload-transcript") {
    return on("legacy") ? { appConfig: APPS.legacy, action: pathname.slice(1) } : null;
  }
  const match = pathname.match(/^\/([^/]+)\/(upload|upload-transcript)$/);
  if (match && APPS[match[1]] && on(match[1])) {
    return { appConfig: APPS[match[1]], action: match[2] };
  }
  return null;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      if (request.method === "POST") {
        const resolved = resolveApp(url.pathname, env);
        if (resolved) {
          return resolved.action === "upload"
            ? await handleUpload(request, env, ctx, resolved.appConfig)
            : await handleTranscriptUpload(request, env, ctx, resolved.appConfig);
        }
      }
      // Audio used to be served here with no login. It now plays only through
      // the Journal site, which reads R2 directly behind its passcode
      // (site/journal/functions/audio/[key].js).
      if (request.method === "GET" && url.pathname.startsWith("/audio/")) {
        return new Response("Gone: audio plays from the Journal site.", { status: 410 });
      }
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("Not found", { status: 404 });
  },
};
