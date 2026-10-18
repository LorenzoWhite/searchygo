import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const RAW_CARDS_PATH = path.join(root, "data/raw/cardinfo.json");
export const CARDS_PATH = path.join(root, "data/cards.json");
export const TAGS_PATH = path.join(root, "data/tags/tags.jsonl");
export const TAG_STATE_PATH = path.join(root, "data/tags/state.json");
export const TAG_FAILURES_PATH = path.join(root, "data/tags/failures.jsonl");
export const TAG_INVALID_REPLIES_PATH = path.join(root, "data/tags/invalid-replies.jsonl");
export const SYNERGY_PATH = path.join(root, "data/synergy/profiles.jsonl");
export const SYNERGY_FAILURES_PATH = path.join(root, "data/synergy/failures.jsonl");
export const SYNERGY_REPLIES_PATH = path.join(root, "data/synergy/replies.jsonl");
export const FEEDBACK_COMMENTS_PATH = path.join(root, "data/feedback/comments.jsonl");
export const FEEDBACK_HANDLED_PATH = path.join(root, "data/feedback/handled.jsonl");
export const COUNTERS_PATH = path.join(root, "data/counters/profiles.jsonl");
export const COUNTERS_FAILURES_PATH = path.join(root, "data/counters/failures.jsonl");
export const COUNTERS_REPLIES_PATH = path.join(root, "data/counters/replies.jsonl");
export const CARD_IMAGES_DIR = path.join(root, "public/cards");
export const ENV_PATH = path.join(root, ".env");
