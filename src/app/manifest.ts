import type { MetadataRoute } from "next";

/** Lets a phone add the site to its home screen with its own name, icon and colours. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Search YGO",
    short_name: "Search YGO",
    description: "Search every Yu-Gi-Oh! card by what it does.",
    start_url: "/",
    display: "standalone",
    // The colour of the mat. A manifest cannot read the stylesheet, so it is written out here.
    background_color: "#1d1007",
    theme_color: "#1d1007",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
