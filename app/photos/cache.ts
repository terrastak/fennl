// Photos kept on this device (phase D2; decided 2026-10-09): every small copy (thumbnail), for
// lists, and the full photos of recently opened recipes up to FULL_BUDGET_BYTES, the oldest
// dropping out first. Anything else is fetched when it's needed. The account on the server is
// what counts (CLAUDE.md, "Core principle"), so losing any of this only costs a download.
//
// Kept in the browser's Cache Storage, one pair of caches per account (and a separate pair for
// an admin acting as someone, wiped on the way out, phase C12). Where Cache Storage isn't
// available (some private windows), photos are simply fetched each time.

export type PhotoSize = "thumb" | "full";

/** How much of this device full photos may use. */
export const FULL_BUDGET_BYTES = 200 * 1024 * 1024;

/** Whose photos: the account, or an admin acting as it (kept apart, phase C12). */
export function photoAccount(userId: string, acting: boolean): string {
  return acting ? `acting-${userId}` : userId;
}

export function photoUrl(hash: string, size: PhotoSize): string {
  return size === "thumb" ? `/api/images/${hash}/thumb` : `/api/images/${hash}`;
}

interface Used {
  bytes: number;
  at: number;
}

export class PhotoCache {
  constructor(private readonly account: string) {}

  private name(size: PhotoSize) {
    return `fennl-${size === "thumb" ? "thumbs" : "photos"}-${this.account}`;
  }

  private get indexKey() {
    return `fennl:photo-index:${this.account}`;
  }

  private readIndex(): Record<string, Used> {
    try {
      return JSON.parse(localStorage.getItem(this.indexKey) ?? "{}") as Record<string, Used>;
    } catch {
      return {};
    }
  }

  private writeIndex(index: Record<string, Used>) {
    try {
      localStorage.setItem(this.indexKey, JSON.stringify(index));
    } catch {
      // Not kept: the cache is trimmed less precisely until the next write.
    }
  }

  private async open(size: PhotoSize): Promise<Cache | null> {
    try {
      return typeof caches === "undefined" ? null : await caches.open(this.name(size));
    } catch {
      return null;
    }
  }

  /** A photo as a blob: from this device if it's here, otherwise from the server (then kept). */
  async get(hash: string, size: PhotoSize): Promise<Blob> {
    const url = photoUrl(hash, size);
    const cache = await this.open(size);
    const hit = await cache?.match(url).catch(() => undefined);
    if (hit) {
      if (size === "full") this.touch(hash);
      return hit.blob();
    }
    const response = await fetch(url, { credentials: "same-origin" });
    if (!response.ok) throw new Error(`Photo not available (${response.status})`);
    const blob = await response.blob();
    await this.keep(hash, size, blob, response.headers.get("cache-control") ?? "");
    return blob;
  }

  /**
   * Keeps a photo on this device: one just added (so it shows without downloading it again), or
   * one just fetched. A full photo standing in for a missing small copy isn't kept as the small
   * copy (the server says so by keeping it only an hour).
   */
  async keep(hash: string, size: PhotoSize, blob: Blob, cacheControl = "") {
    if (size === "thumb" && /max-age=3600\b/.test(cacheControl)) return;
    const cache = await this.open(size);
    if (!cache) return;
    try {
      await cache.put(
        photoUrl(hash, size),
        new Response(blob, { headers: { "content-type": blob.type } }),
      );
    } catch {
      return; // Out of space or not allowed: it will be fetched next time.
    }
    if (size === "full") {
      const index = this.readIndex();
      index[hash] = { bytes: blob.size, at: Date.now() };
      this.writeIndex(index);
      await this.trim(index);
    }
  }

  private touch(hash: string) {
    const index = this.readIndex();
    const entry = index[hash];
    if (!entry) return;
    entry.at = Date.now();
    this.writeIndex(index);
  }

  /** Drops the least recently used full photos until they fit the budget. */
  private async trim(index: Record<string, Used>) {
    let total = Object.values(index).reduce((sum, e) => sum + e.bytes, 0);
    if (total <= FULL_BUDGET_BYTES) return;
    const cache = await this.open("full");
    const oldestFirst = Object.entries(index).sort((a, b) => a[1].at - b[1].at);
    const kept: [string, Used][] = [];
    for (const [hash, entry] of oldestFirst) {
      if (total > FULL_BUDGET_BYTES) {
        await cache?.delete(photoUrl(hash, "full")).catch(() => false);
        total -= entry.bytes;
      } else {
        kept.push([hash, entry]);
      }
    }
    this.writeIndex(Object.fromEntries(kept));
  }

  /** Fetches the small copies not here yet, a few at a time, so lists work offline. */
  async keepThumbs(hashes: string[]): Promise<void> {
    const cache = await this.open("thumb");
    if (!cache) return;
    const missing: string[] = [];
    for (const hash of hashes) {
      if (!(await cache.match(photoUrl(hash, "thumb")).catch(() => undefined))) missing.push(hash);
    }
    const next = async (): Promise<void> => {
      const hash = missing.shift();
      if (!hash) return;
      await this.get(hash, "thumb").catch(() => undefined);
      return next();
    };
    await Promise.all([next(), next(), next(), next()]);
  }

  /** Forgets everything kept for this account on this device. */
  async clear(): Promise<void> {
    try {
      localStorage.removeItem(this.indexKey);
    } catch {
      // Nothing kept.
    }
    if (typeof caches === "undefined") return;
    await Promise.all([
      caches.delete(this.name("thumb")).catch(() => false),
      caches.delete(this.name("full")).catch(() => false),
    ]);
  }
}
