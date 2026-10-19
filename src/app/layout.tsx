import { Analytics } from "@vercel/analytics/next";
import type { Metadata, Viewport } from "next";
import { Vollkorn, Vollkorn_SC } from "next/font/google";
import "../../tokens.css";
import "./globals.css";

const vollkorn = Vollkorn({ subsets: ["latin"], weight: ["400", "600"], style: ["normal", "italic"], variable: "--font-vollkorn" });
const vollkornSc = Vollkorn_SC({ subsets: ["latin"], weight: ["600", "700"], variable: "--font-vollkorn-sc" });

const NAME = "Search YGO";
const TITLE = "Search YGO · Yu-Gi-Oh! card search by effect";
const DESCRIPTION = "Search every Yu-Gi-Oh! card by what it does, find cards that work with your deck, and build decks to export as .ydk.";

export const metadata: Metadata = {
  // Where the site lives, so the addresses in link previews are complete ones.
  metadataBase: new URL("https://searchygo.com"),
  title: TITLE,
  description: DESCRIPTION,
  applicationName: NAME,
  alternates: { canonical: "/" },
  // What is shown when the address is shared. The picture is src/app/opengraph-image.png.
  openGraph: { type: "website", siteName: NAME, title: TITLE, description: DESCRIPTION, url: "/" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // The colour of the mat, for the browser's own bars on a phone.
  themeColor: "#1d1007",
  // The page is designed in its own colours. Without this, phones with a forced dark mode
  // (Chrome on Android, Samsung Internet) recolour the text and leave the parchment light, so the
  // card text turns pale on pale.
  colorScheme: "only light",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${vollkorn.variable} ${vollkornSc.variable}`}>
      <body>
        {/* The halftone screen printed on the mat, behind everything. */}
        <div className="halftone" aria-hidden="true" />
        {children}
        {/* Vercel Web Analytics: page views and visitors, without cookies. Only counts on the deployed site. */}
        <Analytics />
      </body>
    </html>
  );
}
