// Your journal. Written by `npm run setup` (in worker/) or Claude Code's /setup, from setup.json.
// The AI files each memo into exactly one of these categories, guided by the description,
// so write descriptions the way you'd explain the category to a person.
export default {
  journal: [
    { name: "Reflections", description: "Personal reflections: working through feelings, decisions and things that happened." },
    { name: "Thoughts", description: "Business/project ideas and philosophical musings." },
    {
      name: "Daily Reflections",
      description: "Ongoing daily habit: a 'Daily Rundown' subcategory for a recap of the day, and a 'Personal' subcategory for a goodnight message to someone close.",
    },
  ],
};
