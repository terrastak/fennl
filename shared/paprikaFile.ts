import { Gunzip, Inflate } from "fflate";

/**
 * Reading a Paprika 3 export file (phase E13; spec.md E13 step 6): a zip of recipes, each
 * `<name>.paprikarecipe` gzip-compressed JSON. Opened on the person's device, one recipe at a
 * time straight from the file, so a library of any size never has to be held in memory, and an
 * import can pick up where it stopped.
 *
 * The file is checked by its structure, never by its name: the zip's own signature, its list of
 * entries (how many, how large, how much they claim to unpack to) before anything is unpacked,
 * then each recipe as it's unpacked (stopped as soon as it grows past the limits, whatever the
 * zip claimed, so a small file can't expand into gigabytes). The server never sees the file: it
 * only receives ordinary recipe changes and photos, checked like any others.
 */

/**
 * Not plan limits: what a Paprika file may hold, set against the owner's library (827 recipes,
 * 39 MB, its largest recipe 2.2 MB packed and 3 MB unpacked) so it passes comfortably (owner's
 * choice, 2026-10-21).
 */
export const PAPRIKA_RULES = {
  /** Recipes in one file. */
  recipes: 20_000,
  /** Entries of any kind in one file (recipes and anything else zipped with them). */
  entries: 40_000,
  /** One recipe, as stored in the file. */
  entryPacked: 50 * 1024 * 1024,
  /** One recipe, unpacked. */
  entryUnpacked: 60 * 1024 * 1024,
  /** How many times larger than its packed size a recipe may unpack to (past 1 MB). */
  ratio: 50,
} as const;

/** Where the file's bytes come from: a File on the device, or bytes in tests. */
export interface ByteSource {
  size: number;
  read(start: number, end: number): Promise<Uint8Array>;
}

/** A browser File (or Blob) as a ByteSource: read a slice at a time. */
export function blobSource(blob: Blob): ByteSource {
  return {
    size: blob.size,
    read: async (start, end) => new Uint8Array(await blob.slice(start, end).arrayBuffer()),
  };
}

/** Bytes already in memory as a ByteSource. */
export function bytesSource(bytes: Uint8Array): ByteSource {
  return { size: bytes.length, read: (start, end) => Promise.resolve(bytes.subarray(start, end)) };
}

/** Why a whole file was turned away. */
export type PaprikaFileProblem =
  /** Not a zip at all (a text file renamed, a PDF). */
  | "not_zip"
  /** A zip, but with no Paprika recipes in it (a zip of photos). */
  | "not_paprika"
  /** More recipes or entries than one file may hold. */
  | "too_many"
  /** The zip's own list of entries is broken, or it's a kind of zip Paprika doesn't make. */
  | "damaged";

export class PaprikaFileError extends Error {
  constructor(readonly problem: PaprikaFileProblem) {
    super(problem);
  }
}

/** Why one recipe in the file couldn't be unpacked. */
export type EntryProblem = "too_large" | "damaged" | "not_json";

export class PaprikaEntryError extends Error {
  constructor(readonly problem: EntryProblem) {
    super(problem);
  }
}

export interface PaprikaEntry {
  name: string;
  /** 0: stored, 8: deflated. */
  method: number;
  packed: number;
  unpacked: number;
  /** Where its local header starts. */
  offset: number;
}

export interface PaprikaEntries {
  recipes: PaprikaEntry[];
  /** Entries that aren't recipes, which are ignored (and said so in the preview). */
  others: number;
}

const u16 = (b: Uint8Array, at: number) => (b[at] ?? 0) | ((b[at + 1] ?? 0) << 8);
const u32 = (b: Uint8Array, at: number) => (u16(b, at) | (u16(b, at + 2) << 16)) >>> 0;

const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const END = 0x06054b50;

/** Files the zip program adds by itself: macOS's resource forks, folders. */
const isClutter = (name: string) =>
  name.endsWith("/") || name.startsWith("__MACOSX/") || /(^|\/)\._/.test(name);

/**
 * The recipes in a Paprika file, from the zip's own list of entries, before anything is
 * unpacked. Throws PaprikaFileError when the file isn't one.
 */
export async function paprikaEntries(source: ByteSource): Promise<PaprikaEntries> {
  const head = await source.read(0, Math.min(4, source.size));
  if (head.length < 4 || u32(head, 0) !== LOCAL) {
    // An empty zip has only its end record: a zip, but no recipes.
    if (head.length >= 4 && u32(head, 0) === END) throw new PaprikaFileError("not_paprika");
    throw new PaprikaFileError("not_zip");
  }
  // The end record is in the last 22 bytes, plus up to 64 KB of comment.
  const tailStart = Math.max(0, source.size - 22 - 0xffff);
  const tail = await source.read(tailStart, source.size);
  let end = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (u32(tail, i) === END) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new PaprikaFileError("damaged");
  const count = u16(tail, end + 10);
  const dirSize = u32(tail, end + 12);
  const dirOffset = u32(tail, end + 16);
  // A zip too large for its own end record (ZIP64): far past anything Paprika writes.
  if (count === 0xffff || dirSize === 0xffffffff || dirOffset === 0xffffffff) {
    throw new PaprikaFileError("too_many");
  }
  if (count > PAPRIKA_RULES.entries) throw new PaprikaFileError("too_many");
  if (dirOffset + dirSize > tailStart + end || dirSize > count * (46 + 0xffff * 3)) {
    throw new PaprikaFileError("damaged");
  }
  const dir = await source.read(dirOffset, dirOffset + dirSize);
  const recipes: PaprikaEntry[] = [];
  let others = 0;
  let at = 0;
  for (let i = 0; i < count; i++) {
    if (at + 46 > dir.length || u32(dir, at) !== CENTRAL) throw new PaprikaFileError("damaged");
    const flags = u16(dir, at + 8);
    const method = u16(dir, at + 10);
    const packed = u32(dir, at + 20);
    const unpacked = u32(dir, at + 24);
    const nameLength = u16(dir, at + 28);
    const extraLength = u16(dir, at + 30);
    const commentLength = u16(dir, at + 32);
    const offset = u32(dir, at + 42);
    const name = new TextDecoder().decode(dir.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + extraLength + commentLength;
    if (isClutter(name)) continue;
    if (!/\.paprikarecipe$/i.test(name)) {
      others += 1;
      continue;
    }
    // Encrypted (flag bit 0) entries can't be read; they're listed as damaged when read.
    recipes.push({
      name,
      method: flags & 1 ? -1 : method,
      packed,
      unpacked,
      offset,
    });
  }
  if (recipes.length === 0) throw new PaprikaFileError("not_paprika");
  if (recipes.length > PAPRIKA_RULES.recipes) throw new PaprikaFileError("too_many");
  return { recipes, others };
}

/** Feeds bytes through an fflate stream, stopping as soon as the output passes `limit`. */
function unpack(
  make: (ondata: (chunk: Uint8Array, final: boolean) => void) => {
    push(chunk: Uint8Array, final?: boolean): void;
  },
  input: Uint8Array,
  limit: number,
): Uint8Array {
  const chunks: Uint8Array[] = [];
  let size = 0;
  let done = false;
  const stream = make((chunk, final) => {
    size += chunk.length;
    if (size > limit) throw new PaprikaEntryError("too_large");
    chunks.push(chunk);
    if (final) done = true;
  });
  const step = 64 * 1024;
  try {
    for (let i = 0; i < input.length; i += step) {
      stream.push(input.subarray(i, i + step), i + step >= input.length);
    }
    if (input.length === 0) stream.push(new Uint8Array(0), true);
  } catch (error) {
    if (error instanceof PaprikaEntryError) throw error;
    throw new PaprikaEntryError("damaged");
  }
  if (!done) throw new PaprikaEntryError("damaged");
  const out = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

/**
 * One recipe's JSON, unpacked from the file. Throws PaprikaEntryError for a recipe that's too
 * large, damaged (not gzip, cut short) or not JSON; the rest of the file can still be read.
 */
export async function readPaprikaEntry(source: ByteSource, entry: PaprikaEntry): Promise<unknown> {
  if (entry.packed > PAPRIKA_RULES.entryPacked || entry.unpacked > PAPRIKA_RULES.entryUnpacked) {
    throw new PaprikaEntryError("too_large");
  }
  if (entry.method !== 0 && entry.method !== 8) throw new PaprikaEntryError("damaged");
  const header = await source.read(entry.offset, entry.offset + 30);
  if (header.length < 30 || u32(header, 0) !== LOCAL) throw new PaprikaEntryError("damaged");
  const start = entry.offset + 30 + u16(header, 26) + u16(header, 28);
  if (start + entry.packed > source.size) throw new PaprikaEntryError("damaged");
  const packed = await source.read(start, start + entry.packed);
  const gzip =
    entry.method === 8
      ? unpack((ondata) => new Inflate(ondata), packed, PAPRIKA_RULES.entryUnpacked)
      : packed;
  if (gzip[0] !== 0x1f || gzip[1] !== 0x8b) throw new PaprikaEntryError("damaged");
  const limit =
    entry.packed * PAPRIKA_RULES.ratio > 1024 * 1024
      ? Math.min(PAPRIKA_RULES.entryUnpacked, entry.packed * PAPRIKA_RULES.ratio)
      : Math.min(PAPRIKA_RULES.entryUnpacked, 1024 * 1024);
  const json = unpack((ondata) => new Gunzip(ondata), gzip, limit);
  try {
    return JSON.parse(new TextDecoder().decode(json)) as unknown;
  } catch {
    throw new PaprikaEntryError("not_json");
  }
}
