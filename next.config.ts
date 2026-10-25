import type { NextConfig } from "next";

const INDEX_DATA = [
  "./data/cards.json",
  "./data/tags/tags.jsonl",
  "./data/synergy/profiles.jsonl",
  "./data/counters/profiles.jsonl",
  "./data/sets.json",
  "./data/overrides.json",
];

const nextConfig: NextConfig = {
  // The search index is read from data/ at runtime, so make sure it ships with the server bundle.
  // Every route that loads the search index needs the data files it reads (see src/lib/data.ts).
  outputFileTracingIncludes: Object.fromEntries(["/api/search", "/api/sets", "/api/cards", "/api/report"].map((route) => [route, INDEX_DATA])),
  // A card's picture never changes once it is printed, so browsers may keep it for a month. The
  // textures keep their names across redesigns, so those are kept for a week.
  async headers() {
    return [
      { source: "/cards/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=2592000, stale-while-revalidate=86400" }] },
      { source: "/textures/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=604800, stale-while-revalidate=86400" }] },
    ];
  },
};

export default nextConfig;
