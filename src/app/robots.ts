import type { MetadataRoute } from "next";

/** Search engines may index the page; the data endpoints behind it are of no use to them. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: "/api/" },
    sitemap: "https://searchygo.com/sitemap.xml",
  };
}
