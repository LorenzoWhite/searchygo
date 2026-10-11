import type { MetadataRoute } from "next";

/** The site is one page. */
export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: "https://searchygo.com/", changeFrequency: "weekly", priority: 1 }];
}
