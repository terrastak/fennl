/**
 * A likely fix for a mistyped email address (phase U14), shown on "Check your email" once the
 * sign-up link couldn't be delivered: "sarah.lee@gmial.com" → "sarah.lee@gmail.com". Only a
 * suggestion; the person chooses.
 */

/** Common email providers' domains, most used first (a tie goes to the earlier one). */
const PROVIDERS = [
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "comcast.net",
  "verizon.net",
  "att.net",
  "sbcglobal.net",
  "protonmail.com",
  "proton.me",
  "yahoo.co.uk",
  "hotmail.co.uk",
  "btinternet.com",
];

/**
 * Real domains close to a provider's, never "corrected". (The shortest providers' names are
 * never matched loosely at all; see `nameDistance`.)
 */
const ALSO_REAL = new Set([
  "mail.com",
  "email.com",
  "ymail.com",
  "gmx.com",
  "gmx.net",
  "aim.com",
  "att.com",
  "verizon.com",
  "comcast.com",
  "cloud.com",
  "live.co.uk",
]);

/** Endings that are a slip of the finger for any domain: no real domain ends this way. */
const TLD_TYPOS: Record<string, string> = {
  con: "com",
  cmo: "com",
  ocm: "com",
  comm: "com",
  nett: "net",
};

/**
 * Endings that are usually a slip for ".com", but are also a country's own (Colombia, Cameroon,
 * Oman), so put right only for a provider's name ("gmail.co", "hotmail.cm", "gmail.om").
 */
const COM_SLIPS = new Set(["co", "cm", "om"]);

/** The edit distance where swapping two neighbouring letters counts as one edit. */
export function typoDistance(a: string, b: string): number {
  const cols = b.length + 1;
  // Row by row, in one flat list: d[i * cols + j] is the distance between a's first i letters
  // and b's first j.
  const d = new Array<number>((a.length + 1) * cols).fill(0);
  const at = (i: number, j: number) => d[i * cols + j] ?? 0;
  for (let i = 0; i <= a.length; i++) d[i * cols] = i;
  for (let j = 0; j <= b.length; j++) d[j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(at(i - 1, j) + 1, at(i, j - 1) + 1, at(i - 1, j - 1) + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        best = Math.min(best, at(i - 2, j - 2) + 1);
      }
      d[i * cols + j] = best;
    }
  }
  return at(a.length, b.length);
}

const sortedLetters = (text: string) => [...text].sort().join("");

/**
 * How far a typed name (before the ending) is from a provider's, or null when too far. Short
 * names sit close to many real companies' domains (ms.com, aon.com, life.com), so the shortest
 * (me, msn, aol, mac, att) must be typed exactly, a four-letter one (live) may only have two
 * neighbouring letters swapped, and only longer ones may be a letter (or, from 8 letters, two)
 * out.
 */
function nameDistance(typed: string, name: string): number | null {
  if (typed === name) return 0;
  if (name.length <= 3) return null;
  const distance = typoDistance(typed, name);
  if (name.length === 4) {
    const swapped = distance === 1 && sortedLetters(typed) === sortedLetters(name);
    return swapped ? 1 : null;
  }
  return distance <= (name.length >= 8 ? 2 : 1) ? distance : null;
}

/** The domain with an ending no real domain has put right ("gmial.con"), or unchanged. */
function fixEnding(domain: string): string {
  const dot = domain.lastIndexOf(".");
  if (dot < 1) return domain;
  const fixed = TLD_TYPOS[domain.slice(dot + 1)];
  return fixed ? `${domain.slice(0, dot)}.${fixed}` : domain;
}

/** The typed name, when the domain ends with the provider's ending (or a slip for ".com"). */
function typedName(domain: string, ending: string): string | null {
  if (domain.endsWith(`.${ending}`)) return domain.slice(0, -ending.length - 1);
  const dot = domain.lastIndexOf(".");
  if (ending === "com" && dot > 0 && COM_SLIPS.has(domain.slice(dot + 1))) {
    return domain.slice(0, dot);
  }
  // Any other ending ("yahoo.fr", "protonmail.ch") is a country's own, not a slip.
  return null;
}

/** The closest provider's domain, or null. */
function closestProvider(domain: string): string | null {
  let best: { provider: string; distance: number } | null = null;
  for (const provider of PROVIDERS) {
    const dot = provider.indexOf(".");
    const typed = typedName(domain, provider.slice(dot + 1));
    if (typed === null) continue;
    const distance = nameDistance(typed, provider.slice(0, dot));
    if (distance === null) continue;
    if (!best || distance < best.distance) best = { provider, distance };
  }
  return best?.provider ?? null;
}

/**
 * The address with its domain put right when it looks like a typo of a common provider's
 * ("gmial.com", "hotmail.con", "yahoo.co"), or null when it looks fine or Fennl can't tell.
 */
export function suggestEmail(address: string): string | null {
  const trimmed = address.trim();
  const at = trimmed.lastIndexOf("@");
  if (at < 1 || at === trimmed.length - 1) return null;
  const local = trimmed.slice(0, at);
  const domain = trimmed
    .slice(at + 1)
    .toLowerCase()
    .replace(/\.+$/, "");
  if (!/^[a-z0-9.-]+\.[a-z0-9-]+$/.test(domain)) return null;
  if (PROVIDERS.includes(domain) || ALSO_REAL.has(domain)) return null;

  const ended = fixEnding(domain);
  const fixed = closestProvider(ended) ?? ended;
  if (fixed === domain || ALSO_REAL.has(fixed)) return null;
  return `${local}@${fixed}`;
}
