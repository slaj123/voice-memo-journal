import assert from "node:assert";
import {
  slugify,
  buildFilename,
  subcategoriesFromFilenames,
  parseRecordedOn,
  buildCategoryPrompt,
  parseCategoryResponse,
  buildMemoRecord,
} from "../src/lib.js";
import { APPS } from "../src/apps.js";

const { categories: CATEGORIES, categoryDescriptions, extraPromptNotes } = APPS.legacy;

assert.strictEqual(slugify("Surf"), "surf");
assert.strictEqual(slugify("Post-Trip Reflections"), "post-trip-reflections");

assert.strictEqual(
  buildFilename("2026-08-20T07:30:00-07:00", "Activities", "Surfing"),
  "2026-08-20-143000-activities-surfing.json" // normalized to UTC, with seconds
);

assert.deepStrictEqual(CATEGORIES, ["Reflections", "Thoughts", "Activities", "Daily Reflections"]);

assert.deepStrictEqual(
  subcategoriesFromFilenames(
    [
      "2026-08-20-1430-activities-surfing.json",
      "2026-08-22-2145-reflections-processing-a-hard-week.json",
      "2026-08-25-1200-activities-surfing.json",
      "2026-08-26-0915-thoughts-project-ideas.json",
      "README.md",
    ],
    "Activities"
  ),
  ["surfing"]
);

const prompt = buildCategoryPrompt(
  "test transcript",
  { Activities: ["surfing"], Reflections: [] },
  CATEGORIES,
  categoryDescriptions,
  extraPromptNotes
);
assert.ok(prompt.includes("surfing"));
assert.ok(prompt.includes("test transcript"));
assert.ok(prompt.includes("Reflections"));
assert.ok(prompt.includes("Daily Reflections"));

const emptyPrompt = buildCategoryPrompt("first ever memo", {}, CATEGORIES, categoryDescriptions, extraPromptNotes);
assert.ok(emptyPrompt.includes("none yet"));

assert.deepStrictEqual(
  parseCategoryResponse(
    '{"category": "Activities", "subcategory": "Surfing", "headline": "Good session", "summary": "Good session.", "ratings": [{"label": "Surf Quality", "score": 7}]}',
    CATEGORIES
  ),
  {
    category: "Activities",
    subcategory: "Surfing",
    headline: "Good session",
    summary: "Good session.",
    ratings: [{ label: "Surf Quality", score: 7 }],
  }
);

assert.deepStrictEqual(
  parseCategoryResponse(
    '{"category": "Thoughts", "subcategory": "Ideas", "headline": "An idea", "summary": "An idea."}',
    CATEGORIES
  ),
  { category: "Thoughts", subcategory: "Ideas", headline: "An idea", summary: "An idea." }
);

assert.throws(() => parseCategoryResponse("not json", CATEGORIES), /not valid JSON/);
assert.throws(
  () => parseCategoryResponse('{"category": "NotACategory", "subcategory": "x", "headline": "x", "summary": "x"}', CATEGORIES),
  /unknown category/
);
assert.throws(() => parseCategoryResponse('{"category": "Thoughts"}', CATEGORIES), /missing subcategory\/headline\/summary/);

assert.deepStrictEqual(
  buildMemoRecord({
    date: "2026-08-20T07:30:00-07:00",
    category: "Activities",
    subcategory: "Surfing",
    headline: "Good session",
    summary: "Good session.",
    transcript: "Caught some waves.",
  }),
  {
    date: "2026-08-20T07:30:00-07:00",
    category: "Activities",
    subcategory: "Surfing",
    headline: "Good session",
    summary: "Good session.",
    transcript: "Caught some waves.",
  }
);

assert.deepStrictEqual(
  buildMemoRecord({
    date: "2026-08-20T07:30:00-07:00",
    category: "Activities",
    subcategory: "Surfing",
    headline: "Good session",
    summary: "Good session.",
    transcript: "Caught some waves.",
    audioKey: "2026-08-20-1430-activities-surfing.m4a",
  }),
  {
    date: "2026-08-20T07:30:00-07:00",
    category: "Activities",
    subcategory: "Surfing",
    headline: "Good session",
    summary: "Good session.",
    transcript: "Caught some waves.",
    audioKey: "2026-08-20-1430-activities-surfing.m4a",
  }
);

// Old HHmm and new HHmmss filenames both yield subcategories.
assert.deepStrictEqual(
  subcategoriesFromFilenames(["2026-08-20-1430-surfing-dawn.json", "2026-10-12-143005-surfing-swell.json"], "Surfing"),
  ["dawn", "swell"]
);

// recordedAt -> recordedOn (Pacific day).
const NOW = new Date("2026-10-12T20:00:00Z");
assert.strictEqual(parseRecordedOn("2026-10-07", NOW), "2026-10-07");
assert.strictEqual(parseRecordedOn("2026-10-08T03:30:00Z", NOW), "2026-10-07"); // 8:30pm Pacific on the 7th
assert.strictEqual(parseRecordedOn("Oct 7, 2026 at 6:32 PM", NOW), "2026-10-07");
assert.strictEqual(parseRecordedOn("", NOW), null);
assert.strictEqual(parseRecordedOn("not a date", NOW), null);
assert.strictEqual(parseRecordedOn("2027-01-01", NOW), null); // future
assert.strictEqual(parseRecordedOn("2024-01-01", NOW), null); // too old
assert.strictEqual(parseRecordedOn(undefined, NOW), null);

console.log("lib.test.js: all assertions passed");
