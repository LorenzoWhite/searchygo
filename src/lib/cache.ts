/**
 * A small cache that keeps what was used most recently: when it is full, the entry that has gone
 * longest without being read is dropped. A `Map` remembers the order its keys were added in, so
 * putting an entry back on every read keeps the oldest one at the front.
 */
export class RecentCache<Value> {
  private entries = new Map<string, Value>();

  constructor(private readonly capacity: number) {}

  get(key: string): Value | undefined {
    const value = this.entries.get(key);
    if (value === undefined) return undefined;
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  set(key: string, value: Value): void {
    this.entries.delete(key);
    if (this.entries.size >= this.capacity) this.entries.delete(this.entries.keys().next().value!);
    this.entries.set(key, value);
  }

  get size(): number {
    return this.entries.size;
  }
}

/**
 * How long an answer from the card data may be reused. The data only changes when the site is
 * redeployed, so a CDN can hold an answer for a day (and keep serving it for a week while it fetches
 * a fresh one), and a browser for five minutes, which is what makes going back to an earlier search
 * instant.
 */
export const DATA_CACHE_CONTROL = "public, max-age=300, s-maxage=86400, stale-while-revalidate=604800";
