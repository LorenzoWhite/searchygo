/**
 * Features that are switched on per machine while they are tried out, so they can be pushed without
 * reaching the live site: set the variable in .env.local here, and in Vercel's environment settings
 * when the feature goes live. NEXT_PUBLIC_ variables are read by the page as well as the server.
 */
export const FEATURES = {
  /** "Related cards": the button on each card and "related to X" searches. */
  related: process.env.NEXT_PUBLIC_SEARCHYGO_RELATED === "1",
};
