/**
 * Reports people send from synergy and counter results: a card that cannot work with the deck it was
 * shown for ("mismatch"), or a card that does and is missing ("suggestion"). They are only collected
 * here; nothing changes until they are reviewed (see .claude/skills/ygosearchfeedback/SKILL.md).
 *
 * Stored in Upstash Redis when its keys are set (Vercel's Upstash integration sets KV_REST_API_URL and
 * KV_REST_API_TOKEN); on a development machine without them, in data/feedback/site-reports.jsonl.
 */
import fs from "node:fs/promises";
import path from "node:path";

export const REPORT_KINDS = ["mismatch", "suggestion"] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

export interface SiteReport {
  id: string;
  kind: ReportKind;
  /** ISO time it was sent. */
  at: string;
  /** The search it was sent from, as typed. */
  search: string;
  /** The deck the results were for ("Clown Crew"), when the search was a synergy or counters search. */
  deck?: string;
  card: { id: number; name: string };
  /** The sender's explanation. */
  note: string;
}

export const REPORT_LIST = "searchygo:reports";

/**
 * Fixes approved from reports, per deck (data/overrides.json): cards to leave out of a deck's synergy
 * or counter results because they cannot work, and cards to add because they do (with why).
 */
export interface DeckOverrides {
  exclude?: number[];
  include?: { id: number; why: string }[];
}
export interface Overrides {
  synergy: Record<string, DeckOverrides>;
  counters: Record<string, DeckOverrides>;
}
export const NO_OVERRIDES: Overrides = { synergy: {}, counters: {} };
export const LOCAL_REPORTS = path.join(process.cwd(), "data/feedback/site-reports.jsonl");

/** The Upstash REST address and token, under either name the integrations use. */
export function reportStore(): { url: string; token: string } | null {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ""), token } : null;
}

/** Runs one Redis command through Upstash's REST interface. */
export async function redis(store: { url: string; token: string }, command: (string | number)[]): Promise<unknown> {
  const response = await fetch(store.url, {
    method: "POST",
    headers: { authorization: `Bearer ${store.token}`, "content-type": "application/json" },
    body: JSON.stringify(command),
  });
  if (!response.ok) throw new Error(`Report store answered ${response.status}`);
  return ((await response.json()) as { result: unknown }).result;
}

/** Keeps a report. Returns false when there is nowhere to keep it (the live site before storage is set up). */
export async function saveReport(report: SiteReport): Promise<boolean> {
  const store = reportStore();
  if (store) {
    await redis(store, ["RPUSH", REPORT_LIST, JSON.stringify(report)]);
    return true;
  }
  if (process.env.NODE_ENV === "production") return false;
  await fs.mkdir(path.dirname(LOCAL_REPORTS), { recursive: true });
  await fs.appendFile(LOCAL_REPORTS, JSON.stringify(report) + "\n");
  return true;
}
