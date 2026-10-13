import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readWebRecipes } from "../shared/webRecipe";

/**
 * Checks which recipe sites Fennl's web importer reads (phase E3):
 *
 *   npm run import:check-sites [-- domain ...]
 *
 * For each site in sites.json it finds a recipe page (from the home page, then a few likely
 * index pages), runs `readWebRecipes` over it, and writes sites-status.json and
 * docs/marketing/supported-sites.md. Fetching from a server is a weaker test than the Chrome
 * extension, which reads the page as the person's browser shows it, so "blocked" means the site
 * refused this script, not that Fennl can't read it.
 */

type Site = { domain: string; group: string; source: "paprika" | "fennl" };
type Status = "reads" | "partial" | "no-data" | "blocked" | "unreachable";
type Result = { domain: string; status: Status; url: string | null; note: string; checked: string };

const root = join(import.meta.dirname, "..");
// A short agent string gets past bot filters that turn away a full browser one sent from a server.
const UA = "Mozilla/5.0";
const MAX_PAGES = 30;
const REFUSED = new Set([401, 402, 403, 429, 460, 503]);

async function get(url: string): Promise<{ status: number; html: string; url: string } | null> {
  try {
    const res = await fetch(url, {
      headers: { "user-agent": UA, accept: "text/html,*/*", "accept-language": "en" },
      redirect: "follow",
      signal: AbortSignal.timeout(20000),
    });
    const type = res.headers.get("content-type") ?? "";
    const html = /html|xml|text/.test(type) ? (await res.text()).slice(0, 3_000_000) : "";
    return { status: res.status, html, url: res.url };
  } catch {
    return null;
  }
}

/** Links on a page that look like a recipe (or a list of them), best first. */
function candidates(html: string, base: string, host: string): string[] {
  const score = new Map<string, number>();
  for (const m of html.matchAll(/href=["']([^"'#]+)["']/gi)) {
    let url: URL;
    try {
      url = new URL((m[1] as string).replace(/&amp;/g, "&"), base);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(url.protocol)) continue;
    const h = url.hostname.replace(/^www\./, "");
    if (h !== host && !h.endsWith(`.${host}`) && !host.endsWith(`.${h}`)) continue;
    if (/\.(jpe?g|png|gif|webp|svg|css|js|pdf|xml|ico)$/i.test(url.pathname)) continue;
    if (
      /(\/tag\/|\/category\/|\/author\/|\/page\/\d|\/feed|\/cart|\/login|\/about|\/contact)/i.test(
        url.pathname,
      )
    ) {
      continue;
    }
    const path = url.pathname;
    let s = 0;
    if (
      /recip|rezept|recette|receita|ricett|przepis|resep|cuisine|kokki|ruoka|mat\b|oppskrift|recept|opskrift/i.test(
        path,
      )
    ) {
      s += 3;
    }
    if (/\d{4,}|[a-z]+-[a-z]+-[a-z]+/.test(path)) s += 2;
    if (path.split("/").filter(Boolean).length >= 2) s += 1;
    if (s === 0) continue;
    url.hash = "";
    const key = url.toString();
    score.set(key, Math.max(score.get(key) ?? 0, s));
  }
  return [...score.entries()].sort((a, b) => b[1] - a[1]).map(([u]) => u);
}

/** Page addresses from the site's sitemaps, spread across them, recipe-looking ones first. */
async function fromSitemaps(base: string): Promise<string[]> {
  const origin = new URL(base).origin;
  const robots = await get(`${origin}/robots.txt`);
  const maps = [...(robots?.html.matchAll(/^\s*sitemap:\s*(\S+)/gim) ?? [])].map(
    (m) => m[1] as string,
  );
  maps.push(`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`, `${origin}/wp-sitemap.xml`);
  const locs = (xml: string) =>
    [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1] as string);
  const pages: string[] = [];
  const seenMaps = new Set<string>();
  const visit = async (url: string, depth: number) => {
    if (seenMaps.has(url) || seenMaps.size > 6) return;
    seenMaps.add(url);
    const res = await get(url);
    if (!res || res.status >= 400 || !/<loc>/i.test(res.html)) return;
    const found = locs(res.html);
    if (/<sitemapindex/i.test(res.html) && depth < 2) {
      const rank = (u: string) =>
        /recipe|wprm/i.test(u) ? 0 : /post|article|content/i.test(u) ? 1 : 2;
      for (const child of found.sort((a, b) => rank(a) - rank(b)).slice(0, 2))
        await visit(child, depth + 1);
    } else {
      pages.push(...found);
    }
  };
  for (const m of maps) {
    if (pages.length > 0) break;
    await visit(m, 0);
  }
  const likely = pages.filter(
    (u) =>
      /^https?:\/\//.test(u) &&
      !/\.(jpe?g|png|gif|webp|pdf)$/i.test(u) &&
      /[a-z0-9]+-[a-z0-9]+-[a-z0-9]+|recip|\d{4,}/i.test(new URL(u).pathname),
  );
  const step = Math.max(1, Math.floor(likely.length / 24));
  return likely.filter((_, i) => i % step === 0).slice(0, 24);
}

function judge(html: string, url: string): { status: Status; note: string } | null {
  const drafts = readWebRecipes(html, url);
  if (drafts.length === 0) return null;
  const best = drafts.sort(
    (a, b) =>
      (b.fields.ingredients?.value.length ?? 0) +
      (b.fields.directions?.value.length ?? 0) -
      ((a.fields.ingredients?.value.length ?? 0) + (a.fields.directions?.value.length ?? 0)),
  )[0];
  const ing = best?.fields.ingredients?.value.length ?? 0;
  const dir = best?.fields.directions?.value.length ?? 0;
  if (ing >= 2 && dir >= 1) return { status: "reads", note: `${ing} ingredients, ${dir} steps` };
  return { status: "partial", note: `recipe data found, but ${ing} ingredients and ${dir} steps` };
}

async function check(site: Site): Promise<Result> {
  const checked = new Date().toISOString().slice(0, 10);
  const host = site.domain.replace(/^www\./, "");
  const done = (status: Status, url: string | null, note: string): Result => ({
    domain: site.domain,
    status,
    url,
    note,
    checked,
  });

  let home = await get(`https://www.${host}/`);
  if (!home || home.status >= 400) home = (await get(`https://${host}/`)) ?? home;
  if (!home) return done("unreachable", null, "the site did not answer");
  const queue: string[] = [];
  let blocked = REFUSED.has(home.status);
  if (home.status >= 400 && !blocked)
    return done("unreachable", null, `home page answered ${home.status}`);
  if (home.html) queue.push(...candidates(home.html, home.url, host));
  for (const index of ["/recipes/", "/recipes", "/recipe/"]) {
    if (queue.length >= 6) break;
    const page = await get(new URL(index, home.url).toString());
    if (page && page.status < 400 && page.html)
      queue.push(...candidates(page.html, page.url, host));
  }

  if (queue.length < MAX_PAGES) queue.push(...(await fromSitemaps(home.url)));
  let seen = 0;
  let partial: Result | null = null;
  const tried = new Set<string>();
  for (const url of queue) {
    if (tried.has(url)) continue;
    tried.add(url);
    if (++seen > MAX_PAGES) break;
    const page = await get(url);
    if (!page) continue;
    if (REFUSED.has(page.status)) blocked = true;
    if (page.status >= 400 || !page.html) continue;
    const verdict = judge(page.html, page.url);
    if (verdict?.status === "reads") return done("reads", page.url, verdict.note);
    if (verdict && !partial) partial = done("partial", page.url, verdict.note);
  }
  if (partial) return partial;
  if (blocked)
    return done(
      "blocked",
      null,
      "the site refuses downloads by a script; needs a check in a browser",
    );
  if (seen === 0) return done("no-data", null, "no recipe page found from the home page");
  return done("no-data", null, `no recipe data on ${seen} pages tried`);
}

const only = process.argv.slice(2);
const sites = (
  JSON.parse(await readFile(join(import.meta.dirname, "sites.json"), "utf8")) as Site[]
).filter((s) => only.length === 0 || only.includes(s.domain));
const statusPath = join(import.meta.dirname, "sites-status.json");
const previous = new Map<string, Result>();
try {
  for (const r of JSON.parse(await readFile(statusPath, "utf8")) as Result[])
    previous.set(r.domain, r);
} catch {
  // first run
}

const results: Result[] = [];
let next = 0;
await Promise.all(
  Array.from({ length: 8 }, async () => {
    while (next < sites.length) {
      const site = sites[next++] as Site;
      const result = await check(site).catch((e): Result => ({
        domain: site.domain,
        status: "unreachable",
        url: null,
        note: `check failed: ${e instanceof Error ? e.message : String(e)}`,
        checked: new Date().toISOString().slice(0, 10),
      }));
      results.push(result);
      console.log(`${result.status.padEnd(11)} ${site.domain}  ${result.note}`);
    }
  }),
);
for (const r of results) previous.set(r.domain, r);
const all = [...previous.values()].sort((a, b) => a.domain.localeCompare(b.domain));
await writeFile(statusPath, `${JSON.stringify(all, null, 2)}\n`);

const label: Record<Status, string> = {
  reads: "Reads",
  partial: "Partly",
  "no-data": "No recipe data found by script",
  blocked: "Not checked (refused our script)",
  unreachable: "Not reachable",
};
const all_sites = JSON.parse(
  await readFile(join(import.meta.dirname, "sites.json"), "utf8"),
) as Site[];
const byDomain = new Map(all.map((r) => [r.domain, r]));
const count = (s: Status) => all.filter((r) => r.status === s).length;
const lines = [
  "# Recipe sites Fennl can import",
  "",
  "Generated by `npm run import:check-sites` from `import-quality/sites.json` (the sites Paprika lists at",
  "https://www.paprikaapp.com/sites/, plus sites tested while building Fennl). Do not edit by hand.",
  "Kept for marketing: add newly found sites to `sites.json` and re-run.",
  "",
  "Fennl reads a recipe from the page's Schema.org data, not from site-specific code, so it works on",
  "any site that publishes it, and the AI reader (Premium) covers pages that don't. The check below",
  "downloads a recipe page from a server, which some sites refuse. The Chrome extension reads the",
  "page as the person's browser shows it, so a refusal here is expected to be fine there, but it has",
  'not been confirmed site by site: "Not checked" means exactly that. "No recipe data found" means',
  "the script found none on the pages it sampled (a few of which may not be recipes); it does not",
  "prove the site has none, and the AI reader (Premium) covers such pages either way.",
  "",
  `Checked ${all.length} sites: ${count("reads")} read cleanly, ${count("partial")} partly, ` +
    `${count("no-data")} had no recipe data, ${count("blocked")} refused our script, ` +
    `${count("unreachable")} unreachable.`,
  "",
];
for (const group of [...new Set(all_sites.map((s) => s.group))]) {
  lines.push(
    `## ${group}`,
    "",
    "| Site | Result | Checked page | Note |",
    "| --- | --- | --- | --- |",
  );
  for (const s of all_sites.filter((x) => x.group === group)) {
    const r = byDomain.get(s.domain);
    lines.push(
      r
        ? `| ${s.domain} | ${label[r.status]} | ${r.url ? `[page](${r.url})` : ""} | ${r.note} (${r.checked}) |`
        : `| ${s.domain} | Not checked yet | | |`,
    );
  }
  lines.push("");
}
await writeFile(
  join(root, "docs", "marketing", "supported-sites.md"),
  `${lines.join("\n")}\n`,
).catch(async () => {
  const { mkdir } = await import("node:fs/promises");
  await mkdir(join(root, "docs", "marketing"), { recursive: true });
  await writeFile(join(root, "docs", "marketing", "supported-sites.md"), `${lines.join("\n")}\n`);
});
console.log(
  `Done: ${count("reads")} reads, ${count("partial")} partial, ${count("no-data")} no data, ${count("blocked")} blocked, ${count("unreachable")} unreachable.`,
);
