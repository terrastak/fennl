# Import quality test set

How Fennl measures import quality (phase E1 in `spec.md`). Every importer runs over these
samples, and the scorecard compares what it found with the correct answer, field by field: title,
description, each ingredient, each step, times, servings, notes and source.

- `samples.json`: the samples. Each has an `id`, a `kind` (`web`, `card`, `cookbook`,
  `screenshot`, `pdf` or `paprika`), its input files (paths from the repository's root, in reading
  order), a web page's address, and a note on what makes it a useful test.
- `expected/<id>.json`: the correct answer. A file of several recipes (a PDF, a Paprika library)
  has a list of them.
- `importers.ts`: the importers the scorecard runs. Each import phase (E3 to E13) adds its own.
- `npm run import:quality` runs the scorecard and prints the report. CI runs it with the unit
  tests and puts the report on each run's summary page.
- **Must be exact** (decided 2026-10-11): an importer marked `exact` (one reading data a source
  publishes, like a page's recipe data or a Paprika file) must get the ingredients, directions,
  times and servings count exactly right on every sample. Any miss fails CI, and the report's
  "Must be exact" section names it.

**This folder, `test_images/` and `test_pages/` are public** (the repository is public; decided by
the owner 2026-10-10). Only add pages and cards you're happy for anyone to see.

## Adding a web page

    npm run import:save-page -- <sample-id> <page address> [saved .html file]

This saves a trimmed copy of the page to `test_pages/` (`shared/pageSnapshot.ts`): the page's recipe data,
address, name and sharing image, and its recipe card (ingredients, directions, notes). The site's
articles, photos, comments and scripts are left out, since the folder is public. It checks the
importer reads the copy just as it reads the whole page, and prints what it reads as a first draft
of the correct answer. Some sites refuse to be downloaded by a script (Food Network, Allrecipes,
Serious Eats, King Arthur): open the page in a browser, save it ("Save Page As", "Web Page,
Complete" or "HTML only"), and give the saved file as well.

## Writing a correct answer

Write what the source says, the way it says it. Fennl keeps recipe text as written, so the
correct answer is the text a careful person would type in, not a tidied version.

```json
{
  "title": "Sugar Butter Balls",
  "ingredients": ["## For the dough:", "1 cup butter", "1/2 cup sifted powdered sugar"],
  "directions": ["Mix butter, sugar and vanilla, sift flour and salt, add nuts."],
  "times": { "prep": 15, "cook": null, "total": null },
  "servings": { "count": 48, "yield": "4 doz." },
  "description": "The headnote, if there is one.",
  "notes": "Footnotes, tips and variations.",
  "source": { "name": "Cookbook title or site", "author": null, "page": "98", "url": null }
}
```

- One line per ingredient, one step per numbered step or paragraph. A section heading starts
  with `## `.
- Leave a field out when it doesn't matter what's found (no time on the card, say). Use `null` or
  `""` when the right answer is "nothing".
- Small differences are forgiven when scoring: letter case, spacing, curly quotes, `½` against
  `1/2`, bullets and step numbers. Spelling mistakes are not.

## Collecting samples (checklist)

The plan asks for about 30 web pages, 20 card photos, 10 cookbook pages, 10 screenshots, a few
PDFs and a Paprika export. Already in: 31 web pages, 2 cards, 2 cookbook pages, 1 screenshot
recipe (3 images) and 2 PDFs.

- [x] **Web pages (about 30):** 31 pages from your Paprika library (E3), chosen for variety: big
      sites, paywalled ones, blogs on each common recipe card, sections, metric amounts,
      microdata. Still worth adding by hand: pages from Food Network (most of your library),
      Allrecipes and Serious Eats, which refuse automated downloads; a page with two recipes; and
      a few with no recipe data at all, for the AI reader (E8).
- [ ] **Card photos (about 18 more):** printed and handwritten, faded, stained, cursive, both
      sides of a card (front and back as two files of one sample), two recipes on one card, and a
      couple taken badly (angled, shadowed, blurry).
- [ ] **Cookbook pages (about 8 more):** a recipe across two pages, two recipes on one page,
      columns, a photo behind the text, metric and imperial, and a recipe that points to another.
- [ ] **Screenshots (about 9 more):** phone and computer, Instagram or Facebook captions, a
      recipe in a text message, a page cut across several screenshots.
- [ ] **PDFs (a few more):** a printed-to-PDF web page, a scanned family cookbook, a PDF of
      several recipes.
- [x] **Paprika export:** the owner's whole library (827 recipes) is in
      `test_recipes/all-recipes.paprikarecipes`. E2 reads every ingredient line in it
      (`ingredients.test.ts`); E13 will import it.

For each new sample, add it to `samples.json` and the file to `test_images/`, and I'll write the
first draft of its correct answer for you to check.
