// The tests check against these categories, whatever src/setup.js says.
import { configureJournal } from "../src/apps.js";

configureJournal([
  { name: "Reflections", description: "Personal reflections: working through feelings, decisions and things that happened." },
  { name: "Thoughts", description: "Business/project ideas and philosophical musings." },
  { name: "Daily Reflections", description: "Ongoing daily habit: a 'Daily Rundown' subcategory for a recap of the day, and a 'Personal' subcategory for a goodnight message to someone close." },
]);
