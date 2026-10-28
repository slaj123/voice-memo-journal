import assert from "node:assert";
import "./fixed-setup.js";
import { APPS } from "../src/apps.js";
import { buildCategoryPrompt, parseCategoryResponse } from "../src/lib.js";

assert.deepStrictEqual(APPS.journal.categories, ["Reflections", "Thoughts", "Daily Reflections"]);
assert.strictEqual(APPS.journal.memosPath, "journal");
assert.strictEqual(APPS.legacy.memosPath, "");

// Journal's prompt should carry the Daily Reflections subcategory guidance
// but never mention ratings/Activities — that concept doesn't exist there.
const journalPrompt = buildCategoryPrompt(
  "test transcript",
  {},
  APPS.journal.categories,
  APPS.journal.categoryDescriptions,
  APPS.journal.extraPromptNotes
);
assert.ok(journalPrompt.includes("Daily Rundown"));
assert.ok(!journalPrompt.includes("Activities"));
assert.ok(!/ratings? array/i.test(journalPrompt));

assert.deepStrictEqual(
  parseCategoryResponse(
    '{"category": "Reflections", "subcategory": "Processing", "headline": "A quiet evening", "summary": "Thinking things through."}',
    APPS.journal.categories
  ),
  { category: "Reflections", subcategory: "Processing", headline: "A quiet evening", summary: "Thinking things through." }
);

assert.throws(
  () => parseCategoryResponse('{"category": "Activities", "subcategory": "x", "headline": "x", "summary": "x"}', APPS.journal.categories),
  /unknown category/,
  "Activities must not be a valid category for the journal app"
);

console.log("apps.test.js: all assertions passed");
