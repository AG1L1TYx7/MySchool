/**
 * An in-memory cache with a time to live per entry (docs/11 section 4: every cache has an explicit
 * invalidation path, which here is `delete` and `clear`). The clock is injectable for tests. Entries are
 * swept when the map grows past `maxEntries`, so a long-running process never holds more than that.
 */
export class TtlCache<T> {
  private readonly entries = new Map<string, { value: T; expiresAt: number }>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 10_000,
    private readonly now: () => number = () => Date.now(),
  ) {}

  get(key: string): T | undefined {
    const e = this.entries.get(key);
    if (!e) return undefined;
    if (e.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return e.value;
  }

  set(key: string, value: T): void {
    if (this.entries.size >= this.maxEntries) this.sweep();
    this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs });
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }

  private sweep(): void {
    const t = this.now();
    for (const [k, e] of this.entries)
      if (e.expiresAt <= t) this.entries.delete(k);
    // Still full of live entries: drop the oldest half rather than grow without bound.
    if (this.entries.size >= this.maxEntries) {
      let n = Math.floor(this.entries.size / 2);
      for (const k of this.entries.keys()) {
        if (n-- <= 0) break;
        this.entries.delete(k);
      }
    }
  }
}
