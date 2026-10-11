/**
 * Where card images are served from. YGOPRODeck asks sites to host their own copies, so the images
 * are downloaded once by `scripts/fetch-images.ts` into public/cards/. Set NEXT_PUBLIC_CARD_IMAGE_BASE
 * to serve them from a CDN or bucket instead of from this app.
 */
const BASE = (process.env.NEXT_PUBLIC_CARD_IMAGE_BASE ?? "/cards").replace(/\/$/, "");

/** Pixel size of the "small" card image, for reserving layout space before it loads. */
export const SMALL_CARD_IMAGE = { width: 268, height: 391 } as const;

export const cardImageUrl = (id: number) => `${BASE}/small/${id}.jpg`;
