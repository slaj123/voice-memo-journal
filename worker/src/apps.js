// Registry of logging apps sharing this Worker + repo. Each app has its
// own fixed category set, its own memos/ subfolder in the repo, and its
// own prompt notes. Adding a new app (e.g. workout, dailylog) means adding
// an entry here plus wiring its routes in index.js — no changes needed to
// the category-tagging logic in lib.js.

const REFLECTIONS_DESCRIPTION =
  "Personal reflections: working through feelings, decisions and things that happened.";
const DAILY_REFLECTIONS_DESCRIPTION =
  "Ongoing daily habit, going forward: a 'Daily Rundown' subcategory for a recap of the day, and a 'Personal' subcategory for a goodnight message to someone close.";
const DAILY_REFLECTIONS_SUBCATEGORY_NOTE =
  "For Daily Reflections specifically: prefer 'Personal' whenever the memo includes a goodnight or message addressed to a person, and use 'Daily Rundown' only when it doesn't.";

export const APPS = {
  // The original, un-prefixed /upload + /upload-transcript routes. Kept
  // exactly as before so the existing iOS Shortcut (Thoughts/Activities)
  // needs no changes. Covers everything not yet split into its own app.
  legacy: {
    memosPath: "",
    categories: ["Reflections", "Thoughts", "Activities", "Daily Reflections"],
    categoryDescriptions: {
      Reflections: REFLECTIONS_DESCRIPTION,
      Thoughts: "Business/project ideas and philosophical musings.",
      Activities: "Logs of physical activities — surfing, lifting, kitesurfing, travel, etc. — often with a self-rated score.",
      "Daily Reflections": DAILY_REFLECTIONS_DESCRIPTION,
    },
    extraPromptNotes: [
      DAILY_REFLECTIONS_SUBCATEGORY_NOTE,
      "Only for Activities memos: if the speaker explicitly states one or more numeric ratings out of 10 (e.g. a surf-quality score, an overall-experience score), include them as a ratings array with short labels. Never infer or estimate a rating that wasn't explicitly stated — omit the field entirely otherwise.",
    ],
  },

  // /journal/upload + /journal/upload-transcript. Personal journal —
  // entirely private, no ratings concept. Thoughts was added 2026-09-21
  // when the legacy app's single remaining Thoughts memo was migrated in.
  journal: {
    memosPath: "journal",
    categories: ["Reflections", "Thoughts", "Daily Reflections"],
    categoryDescriptions: {
      Reflections: REFLECTIONS_DESCRIPTION,
      Thoughts: "Business/project ideas and philosophical musings.",
      "Daily Reflections": DAILY_REFLECTIONS_DESCRIPTION,
    },
    extraPromptNotes: [DAILY_REFLECTIONS_SUBCATEGORY_NOTE],
  },

  // /workout/upload + /workout/upload-transcript. Entirely private, same
  // Basic Auth credentials as Journal. `extractExercises` turns on the
  // structured sets/reps/weight extraction in the shared GPT prompt (only
  // used for the Lifting categories — see LIFTING_CATEGORIES below).
  // `reserveWatchField` stamps every memo with a `watchData: null`
  // placeholder for a not-yet-built Apple Watch ingestion path.
  // `openCategories`: one category per activity instead of a fixed handful
  // (decided 2026-09-21) — the seed list below is just a starting point.
  // When a memo describes an activity that doesn't fit any known category,
  // the model proposes a short new one and the Worker records it in
  // `memos/workout/categories.json` so it's "known" from then on.
  workout: {
    memosPath: "workout",
    categories: [
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
    ],
    categoryDescriptions: {
      "Lifting (Push)": "Weight training — chest/shoulders/triceps push movements. Extract every exercise performed with its sets (reps and weight).",
      "Lifting (Pull)": "Weight training — back/biceps pull movements. Extract every exercise performed with its sets (reps and weight).",
      "Lifting (Legs)": "Weight training — legs/glutes/core. Extract every exercise performed with its sets (reps and weight).",
      Surfing: "Surfing session.",
      Kitesurfing: "Kitesurfing session.",
      Basketball: "Basketball, pickup or organized.",
      Tennis: "Tennis, singles or doubles.",
      Swimming: "Swimming, pool or open water.",
      Climbing: "Rock climbing, indoor or outdoor.",
      Golf: "Golf, round or practice/range session.",
      Yoga: "Yoga session or class.",
      Running: "Running or jogging.",
    },
    extraPromptNotes: [
      "If the speaker explicitly states one or more numeric ratings out of 10 (e.g. an overall-effort or session-quality score), include them as a ratings array with short labels, regardless of category. Never infer or estimate a rating that wasn't explicitly stated — omit the field entirely otherwise.",
    ],
    openCategories: true,
    extractExercises: true,
    reserveWatchField: true,
    // Workouts live in the Workout Log app (the workout-log kit: Worker + D1).
    // Voice memos to /workout/upload are still transcribed
    // and tagged here, then POSTed to its /api/ingest instead of committed
    // to GitHub. See deliverToIngest in index.js.
    deliverToIngest: true,
  },

  // /dailylog/upload + /dailylog/upload-transcript. Entirely private, same
  // Basic Auth credentials as Journal and Workout Logger. A completely new,
  // general-purpose catch-all, separate from legacy's Thoughts and
  // Activities categories.
  dailylog: {
    memosPath: "dailylog",
    // After the commit, ping the Habits app (Daily Log is a required daily
    // habit there). See notifyHabits in index.js.
    notifyHabits: true,
    categories: ["Daily Log"],
    categoryDescriptions: {
      "Daily Log":
        "General catch-all for daily notes, ideas, errands, and anything that doesn't fit Journal (personal reflections) or Workout Logger (structured exercise tracking).",
    },
    extraPromptNotes: [],
  },
};
