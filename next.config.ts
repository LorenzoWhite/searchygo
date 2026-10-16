import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The search index is read from data/ at runtime, so make sure it ships with the server bundle.
  outputFileTracingIncludes: {
    "/api/search": ["./data/cards.json", "./data/tags/tags.jsonl", "./data/synergy/profiles.jsonl", "./data/counters/profiles.jsonl"],
    "/api/cards": ["./data/cards.json", "./data/tags/tags.jsonl", "./data/synergy/profiles.jsonl"],
  },
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
