function slugify(topic) {
  return topic.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function buildFilename(date, category, subcategory) {
  const d = new Date(date);
  const stamp = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}-${pad(
    d.getUTCHours()
  )}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
  return `${stamp}-${slugify(category)}-${slugify(subcategory)}.json`;
}

// Filenames look like YYYY-MM-DD-HHmmss-<category-slug>-<subcategory-slug>.json
// (seconds added 2026-10-12 so two same-tag memos in one minute can't collide;
// older files have HHmm).
// Recovering known subcategories per category from a directory listing lets
// the prompt ask the model to reuse one instead of downloading every file.
function subcategoriesFromFilenames(filenames, category) {
  const categorySlugValue = slugify(category);
  const slugs = new Set();
  for (const name of filenames) {
    const match = name.match(/^\d{4}-\d{2}-\d{2}-\d{4}(?:\d{2})?-(.+)\.json$/);
    if (!match) continue;
    const rest = match[1];
    if (!rest.startsWith(`${categorySlugValue}-`)) continue;
    slugs.add(rest.slice(categorySlugValue.length + 1));
  }
  return [...slugs].sort();
}

function buildCategoryPrompt(transcript, knownSubcategoriesByCategory, categories, categoryDescriptions, extraPromptNotes = [], extractExercises = false, openCategories = false) {
  const categoryLines = categories
    .map((category) => {
      const known = knownSubcategoriesByCategory[category] || [];
      const knownList = known.length ? known.join(", ") : "(none yet)";
      const description = categoryDescriptions[category] || "";
      return `- ${category}: ${description} Known subcategories (as slugs): ${knownList}`;
    })
    .join("\n");

  const jsonSchema = extractExercises
    ? '{"category": string, "subcategory": string, "headline": string, "summary": string, "ratings": [{"label": string, "score": number}], "exercises": [{"name": string, "sets": [{"reps": number, "weight": number|null, "unit": "lb"|"kg"|null}]}]}'
    : '{"category": string, "subcategory": string, "headline": string, "summary": string, "ratings": [{"label": string, "score": number}]}';

  return [
    openCategories
      ? "You are tagging a personal voice memo transcript for a private journal site. Categories are one per activity, not fixed — reuse a known one below if the memo clearly matches it."
      : "You are tagging a personal voice memo transcript for a private journal site with a fixed set of categories.",
    openCategories ? "Known categories:" : "Categories (pick exactly one):",
    categoryLines,
    ...(openCategories
      ? ["If the memo describes an activity that doesn't fit any known category, propose a short new category name (1-3 words, e.g. \"Skiing\") instead of forcing it into one of the above."]
      : []),
    "",
    "Then pick a subcategory within that category — reuse a known one if the memo clearly fits it, otherwise propose a short new one (1-3 words).",
    "A memo can only carry one subcategory even if it touches multiple things.",
    ...extraPromptNotes,
    "Write a short headline (6-10 words) capturing the gist, and a 1-3 sentence exec-summary.",
    "Respond with strict JSON only, no markdown fences:",
    jsonSchema,
    "(omit \"ratings\" entirely, don't send an empty array, when no rating was stated)",
    ...(extractExercises
      ? ["(only include \"exercises\" for Lifting memos, and only sets whose reps/weight were explicitly stated — never invent or estimate numbers; omit \"exercises\" entirely for every other category)"]
      : []),
    "",
    "Transcript:",
    transcript,
  ].join("\n");
}

function parseCategoryResponse(raw, categories, { extractExercises = false, openCategories = false } = {}) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Model response was not valid JSON: ${raw}`);
  }
  if (openCategories) {
    if (typeof parsed.category !== "string" || !parsed.category.trim()) {
      throw new Error(`Model response missing category: ${raw}`);
    }
  } else if (!categories.includes(parsed.category)) {
    throw new Error(`Model response has unknown category: ${raw}`);
  }
  if (typeof parsed.subcategory !== "string" || typeof parsed.headline !== "string" || typeof parsed.summary !== "string") {
    throw new Error(`Model response missing subcategory/headline/summary: ${raw}`);
  }
  const result = {
    category: openCategories ? parsed.category.trim() : parsed.category,
    subcategory: parsed.subcategory.trim(),
    headline: parsed.headline.trim(),
    summary: parsed.summary.trim(),
  };
  if (Array.isArray(parsed.ratings) && parsed.ratings.length) {
    result.ratings = parsed.ratings.map((r) => ({ label: String(r.label).trim(), score: Number(r.score) }));
  }
  if (extractExercises && Array.isArray(parsed.exercises) && parsed.exercises.length) {
    result.exercises = parsed.exercises.map((e) => ({
      name: String(e.name).trim(),
      sets: Array.isArray(e.sets)
        ? e.sets.map((s) => ({
            reps: Number(s.reps),
            weight: s.weight == null ? null : Number(s.weight),
            unit: s.unit || null,
          }))
        : [],
    }));
  }
  return result;
}

// The day a memo is about, from an optional `recordedAt` the Shortcut sends
// (the Voice Memo file's creation date). Accepts YYYY-MM-DD, ISO 8601, or
// iOS's "Oct 7, 2026 at 6:32 PM". Returns YYYY-MM-DD in Pacific time, or
// null if missing, unparseable, in the future, or over a year old, in which
// case the memo still goes through, dated by its upload time.
function parseRecordedOn(value, now = new Date()) {
  if (typeof value !== "string" || !value.trim()) return null;
  const v = value.trim();
  let d;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) d = new Date(`${v}T12:00:00-07:00`);
  else d = new Date(v.replace(/\s+at\s+/i, " "));
  if (isNaN(d)) return null;
  if (d - now > 36 * 3600e3 || now - d > 366 * 86400e3) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(v)
    ? v
    : new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(d);
}

// `reserveWatchField`: apps that plan to merge in Apple Watch data (e.g.
// workout) get a `watchData: null` placeholder on every memo, so a future
// ingestion path (not yet built — mechanism still undecided) has a
// consistent field to patch rather than needing a schema migration later.
function buildMemoRecord({ date, recordedOn, category, subcategory, headline, summary, transcript, ratings, audioKey, exercises, reserveWatchField }) {
  const record = { date, category, subcategory, headline, summary, transcript };
  if (recordedOn) record.recordedOn = recordedOn;
  if (ratings && ratings.length) record.ratings = ratings;
  if (exercises && exercises.length) record.exercises = exercises;
  if (audioKey) record.audioKey = audioKey;
  if (reserveWatchField) record.watchData = null;
  return record;
}

export {
  slugify,
  buildFilename,
  subcategoriesFromFilenames,
  buildCategoryPrompt,
  parseCategoryResponse,
  buildMemoRecord,
  parseRecordedOn,
};
