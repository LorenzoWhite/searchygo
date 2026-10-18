import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: "https://searchygo.com/", changeFrequency: "weekly", priority: 1 },
    { url: "https://searchygo.com/credits", changeFrequency: "weekly", priority: 0.3 },
  ];
}
