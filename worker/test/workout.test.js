import assert from "node:assert";
import { APPS } from "../src/apps.js";
import { buildCategoryPrompt, parseCategoryResponse, buildMemoRecord } from "../src/lib.js";

assert.deepStrictEqual(APPS.workout.categories, [
  "Lifting (Push)",
  "Lifting (Pull)",
  "Lifting (Legs)",
  "Surfing",
  "Kitesurfing",
  "Basketball",
  "Tennis",
  "Swimming",
  "Climbing",
  "Golf",
  "Yoga",
  "Running",
]);
assert.strictEqual(APPS.workout.memosPath, "workout");
assert.strictEqual(APPS.workout.extractExercises, true);
assert.strictEqual(APPS.workout.openCategories, true);
assert.strictEqual(APPS.workout.reserveWatchField, true);

// The prompt should ask for structured exercises when extractExercises is on.
const workoutPrompt = buildCategoryPrompt(
  "Bench pressed 135 for 3 sets of 8",
  {},
  APPS.workout.categories,
  APPS.workout.categoryDescriptions,
  APPS.workout.extraPromptNotes,
  APPS.workout.extractExercises,
  APPS.workout.openCategories
);
assert.ok(workoutPrompt.includes('"exercises"'));
assert.ok(/never invent or estimate/i.test(workoutPrompt));

// openCategories prompts should invite a new category proposal instead of forcing a fixed pick.
assert.ok(/propose a short new category name/i.test(workoutPrompt));

// An activity not in the seed list is accepted, not rejected, since categories are open-ended.
const skiingParsed = parseCategoryResponse(
  JSON.stringify({
    category: "Skiing",
    subcategory: "Resort Day",
    headline: "Skied at the resort",
    summary: "A day of skiing.",
  }),
  APPS.workout.categories,
  { openCategories: true }
);
assert.strictEqual(skiingParsed.category, "Skiing");

// Journal's prompt (extractExercises not set) must not mention exercises at all.
const journalPrompt = buildCategoryPrompt(
  "test transcript",
  {},
  APPS.journal.categories,
  APPS.journal.categoryDescriptions,
  APPS.journal.extraPromptNotes
);
assert.ok(!journalPrompt.includes('"exercises"'));

// Parsing a Lifting (Push) response extracts the exercises array.
const parsed = parseCategoryResponse(
  JSON.stringify({
    category: "Lifting (Push)",
    subcategory: "Push Day",
    headline: "Chest and triceps session",
    summary: "Worked bench press and dips.",
    exercises: [
      { name: "Bench Press", sets: [{ reps: 8, weight: 135, unit: "lb" }, { reps: 6, weight: 145, unit: "lb" }] },
    ],
  }),
  APPS.workout.categories,
  { extractExercises: true, openCategories: true }
);
assert.deepStrictEqual(parsed.exercises, [
  { name: "Bench Press", sets: [{ reps: 8, weight: 135, unit: "lb" }, { reps: 6, weight: 145, unit: "lb" }] },
]);

// A set with no stated weight (bodyweight exercise) keeps weight as null rather than inventing a number.
const bodyweightParsed = parseCategoryResponse(
  JSON.stringify({
    category: "Lifting (Pull)",
    subcategory: "Pull Day",
    headline: "Pull-up session",
    summary: "Did pull-ups.",
    exercises: [{ name: "Pull-ups", sets: [{ reps: 10, weight: null, unit: null }] }],
  }),
  APPS.workout.categories,
  { extractExercises: true, openCategories: true }
);
assert.strictEqual(bodyweightParsed.exercises[0].sets[0].weight, null);

// Without extractExercises, an exercises field in the raw response is ignored.
const ignored = parseCategoryResponse(
  JSON.stringify({
    category: "Reflections",
    subcategory: "Processing",
    headline: "x",
    summary: "x",
    exercises: [{ name: "should be ignored", sets: [] }],
  }),
  APPS.journal.categories
);
assert.strictEqual(ignored.exercises, undefined);

// buildMemoRecord: reserveWatchField stamps watchData: null; other apps are unaffected.
const workoutRecord = buildMemoRecord({
  date: "2026-09-21T18:00:00Z",
  category: "Lifting (Push)",
  subcategory: "Push Day",
  headline: "Chest day",
  summary: "Bench and dips.",
  transcript: "Did bench press.",
  exercises: [{ name: "Bench Press", sets: [{ reps: 8, weight: 135, unit: "lb" }] }],
  reserveWatchField: true,
});
assert.strictEqual(workoutRecord.watchData, null);
assert.deepStrictEqual(workoutRecord.exercises, [{ name: "Bench Press", sets: [{ reps: 8, weight: 135, unit: "lb" }] }]);

const journalRecord = buildMemoRecord({
  date: "2026-09-21T18:00:00Z",
  category: "Reflections",
  subcategory: "Processing",
  headline: "x",
  summary: "x",
  transcript: "x",
});
assert.strictEqual("watchData" in journalRecord, false);
assert.strictEqual("exercises" in journalRecord, false);

console.log("workout.test.js: all assertions passed");
