import assert from "node:assert";
import { APPS } from "../src/apps.js";
import { buildCategoryPrompt, parseCategoryResponse } from "../src/lib.js";

assert.deepStrictEqual(APPS.dailylog.categories, ["Daily Log"]);
assert.strictEqual(APPS.dailylog.memosPath, "dailylog");
assert.strictEqual(APPS.dailylog.extractExercises, undefined);
assert.strictEqual(APPS.dailylog.reserveWatchField, undefined);

// Daily Log's prompt should carry only its own category — no leakage from
// Journal's Reflections or the legacy app's Thoughts/Activities.
const dailyLogPrompt = buildCategoryPrompt(
  "test transcript",
  {},
  APPS.dailylog.categories,
  APPS.dailylog.categoryDescriptions,
  APPS.dailylog.extraPromptNotes
);
assert.ok(dailyLogPrompt.includes("Daily Log"));
assert.ok(!dailyLogPrompt.includes("Reflections"));
assert.ok(!dailyLogPrompt.includes("Activities"));
assert.ok(!dailyLogPrompt.includes("Thoughts"));
assert.ok(!dailyLogPrompt.includes('"exercises"'));

assert.deepStrictEqual(
  parseCategoryResponse(
    '{"category": "Daily Log", "subcategory": "Errands", "headline": "Ran errands", "summary": "Picked up groceries and mail."}',
    APPS.dailylog.categories
  ),
  { category: "Daily Log", subcategory: "Errands", headline: "Ran errands", summary: "Picked up groceries and mail." }
);

assert.throws(
  () => parseCategoryResponse('{"category": "Reflections", "subcategory": "x", "headline": "x", "summary": "x"}', APPS.dailylog.categories),
  /unknown category/,
  "Reflections must not be a valid category for the dailylog app"
);

console.log("dailylog.test.js: all assertions passed");
