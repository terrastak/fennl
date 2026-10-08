import type { DirectionStep, IngredientLine } from "../../shared/recipe";
import type { ExportPerson, ExportRecipe } from "../../shared/exportFormat";
import { servingsText, sourceLine, timeText } from "../../shared/recipeText";

// The export's web pages (phase C10): one per recipe, and a contents page. Plain, self-contained
// HTML that opens in any browser and prints well, years from now, with no Fennl needed.

const escape = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Text as HTML, line breaks kept. */
const paragraphs = (text: string) =>
  text
    .split(/\n{2,}/)
    .filter((p) => p.trim())
    .map((p) => `<p>${escape(p.trim()).replace(/\n/g, "<br>")}</p>`)
    .join("\n");

const STYLE = `
  body { font: 17px/1.55 Georgia, "Times New Roman", serif; color: #222; background: #fff;
    max-width: 44rem; margin: 2rem auto; padding: 0 1rem; }
  h1 { font-size: 2rem; line-height: 1.2; margin: 0.5rem 0; }
  h2 { font-size: 1.3rem; margin: 2rem 0 0.5rem; }
  h3 { font-size: 1.05rem; margin: 1.2rem 0 0.3rem; }
  .muted { color: #666; font-size: 0.95rem; }
  .facts { display: flex; flex-wrap: wrap; gap: 0.3rem 1.5rem; padding: 0; list-style: none; }
  ul.ingredients { padding-left: 1.2rem; }
  ol li, ul li { margin: 0.3rem 0; }
  a { color: #24476b; }
  blockquote { margin: 0.8rem 0; padding-left: 1rem; border-left: 3px solid #ddd; }
  @media print { a { color: inherit; text-decoration: none; } .noprint { display: none; } }
`;

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title>
<style>${STYLE}</style>
</head>
<body>
${body}
</body>
</html>
`;
}

/** Lines under their section headings; directions numbered across sections. */
function lines(items: (IngredientLine | DirectionStep)[], numbered: boolean): string {
  const out: string[] = [];
  let open = false;
  let step = 0;
  const close = () => {
    if (open) out.push(numbered ? "</ol>" : "</ul>");
    open = false;
  };
  for (const line of items) {
    if (line.heading) {
      close();
      out.push(`<h3>${escape(line.text)}</h3>`);
      continue;
    }
    if (!open) {
      out.push(numbered ? `<ol start="${step + 1}">` : `<ul class="ingredients">`);
      open = true;
    }
    step += 1;
    out.push(`<li>${escape(line.text)}</li>`);
  }
  close();
  return out.join("\n");
}

const name = (people: Map<string, string>, userId: string) => people.get(userId) ?? "Someone";

/** A recipe's own page. */
export function recipePage(recipe: ExportRecipe, people: ExportPerson[]): string {
  const names = new Map(people.map((p) => [p.userId, p.name]));
  const facts = [
    ["Prep", timeText(recipe.times.prep)],
    ["Cook", timeText(recipe.times.cook)],
    ["Total", timeText(recipe.times.total)],
    ["Makes", servingsText(recipe.servings)],
    ["Difficulty", recipe.difficultyText ?? recipe.difficulty],
  ].filter((f): f is [string, string] => Boolean(f[1]));
  const source = sourceLine(recipe.source);
  const parts = [
    `<p class="noprint"><a href="../index.html">← All recipes</a></p>`,
    recipe.source.kind === "person" && recipe.source.name
      ? `<p class="muted">${escape(recipe.source.name)}</p>`
      : "",
    `<h1>${escape(recipe.title)}</h1>`,
    recipe.description.trim() ? paragraphs(recipe.description) : "",
    facts.length
      ? `<ul class="facts">${facts.map(([k, v]) => `<li><strong>${k}:</strong> ${escape(v)}</li>`).join("")}</ul>`
      : "",
    recipe.categories.length
      ? `<p class="muted">Categories: ${recipe.categories.map(escape).join(", ")}</p>`
      : "",
    recipe.ingredients.length ? `<h2>Ingredients</h2>\n${lines(recipe.ingredients, false)}` : "",
    recipe.directions.length ? `<h2>Method</h2>\n${lines(recipe.directions, true)}` : "",
  ];

  const notes = recipe.opinions.filter((o) => o.note.trim());
  if (recipe.notes.trim() || notes.length) {
    parts.push(
      `<h2>Notes</h2>`,
      recipe.notes.trim() ? paragraphs(recipe.notes) : "",
      ...notes.map(
        (o) =>
          `<blockquote>${paragraphs(o.note)}<p class="muted">— ${escape(name(names, o.userId))}</p></blockquote>`,
      ),
    );
  }
  const rated = recipe.opinions.filter((o) => o.rating !== null || o.favorite);
  if (rated.length) {
    parts.push(
      `<p class="muted">${rated
        .map(
          (o) =>
            `${escape(name(names, o.userId))}: ${o.rating !== null ? `${"★".repeat(o.rating)}` : ""}${
              o.favorite ? " (a favorite)" : ""
            }`,
        )
        .join(" · ")}</p>`,
    );
  }
  if (recipe.made.length) {
    const last = recipe.made[0];
    if (last) {
      parts.push(
        `<p class="muted">Made ${recipe.made.length} ${recipe.made.length === 1 ? "time" : "times"}; last on ${last.madeOn} by ${escape(name(names, last.userId))}.</p>`,
      );
    }
  }
  if (recipe.nutrition) {
    const values = Object.entries(recipe.nutrition.perServing);
    if (values.length || recipe.nutrition.text) {
      parts.push(
        `<h2>Nutrition per serving</h2>`,
        values.length
          ? `<ul class="facts">${values.map(([k, v]) => `<li><strong>${escape(k)}:</strong> ${v}</li>`).join("")}</ul>`
          : "",
        recipe.nutrition.text ? paragraphs(recipe.nutrition.text) : "",
      );
    }
  }
  if (source || recipe.source.url) {
    const label = escape(source ?? recipe.source.url ?? "");
    parts.push(
      `<p class="muted">Source: ${
        recipe.source.url ? `<a href="${escape(recipe.source.url)}">${label}</a>` : label
      }</p>`,
    );
  }
  parts.push(`<p class="muted">Added by ${escape(name(names, recipe.ownerUserId))}.</p>`);
  return page(recipe.title, parts.filter(Boolean).join("\n"));
}

export interface ContentsEntry {
  title: string;
  file: string;
  categories: string[];
}

/** The contents page: every recipe, A to Z, with a word about the files. */
export function contentsPage(entries: ContentsEntry[], exportedAt: string): string {
  const sorted = [...entries].sort((a, b) =>
    a.title.localeCompare(b.title, undefined, { sensitivity: "base" }),
  );
  const body = `
<h1>Your recipes</h1>
<p class="muted">Exported from Fennl on ${escape(exportedAt.slice(0, 10))}: ${entries.length} ${
    entries.length === 1 ? "recipe" : "recipes"
  }. Each one is a page you can open in any web browser. <code>fennl-recipes.json</code> has
the same recipes as data, for moving them to another app or back into Fennl.</p>
<ul>
${sorted
  .map(
    (e) =>
      `<li><a href="${escape(e.file)}">${escape(e.title)}</a>${
        e.categories.length
          ? ` <span class="muted">(${e.categories.map(escape).join(", ")})</span>`
          : ""
      }</li>`,
  )
  .join("\n")}
</ul>`;
  return page("Your recipes", body);
}

/** A file name for a recipe's page: its title, made safe, and part of its ID. */
export function recipeFile(recipe: { id: string; title: string }): string {
  const slug =
    recipe.title
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "recipe";
  return `recipes/${slug}-${recipe.id.slice(0, 8)}.html`;
}
