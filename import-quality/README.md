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
  "directions": ["Mix butter, sugar and vanilla, sift, flour and salt add nuts."],
  "times": { "prep": 15, "cook": null, "total": null },
  "servings": { "count": 48, "yield": "4 doz." },
  "description": "The headnote, if there is one.",
  "notes": "Footnotes, tips and variations.",
  "source": { "name": "Cookbook title or site", "author": null, "page": "98", "url": null }
}
```

- One line per ingredient, one step per numbered step or paragraph. A section heading starts
  with `## `.
- A handwritten method has one step per sentence: split at full stops and at dashes between
  instructions, and where a new instruction starts with a capital ("Boil", "Pour") even without a
  full stop or after a comma; otherwise never at commas or semicolons. Keep the words as written
  (each step starting with a capital, without the leftover dash or comma). Printed paragraphs and
  numbered steps stay as they are. The owner's choice, 2026-10-20 and 2026-10-21
  (`choc-pie-card`).
- Except on web pages, write abbreviated units after an amount as Fennl does after reading
  (`standardIngredient` and `standardUnits`, `shared/ingredients.ts`): `tsp`, `Tbsp`, `cup` or
  `cups`, `oz`, `lb` ("1/2 teas" is "1/2 tsp", "1T" is "1 Tbsp", "2 C" is "2 cups"), and "soda"
  measured by the spoon is "baking soda". Units written out in full stay as written. A slip of
  the pen ("boil for 2 seconds") stays as written. The owner's choice, 2026-10-21.
- Screenshots (E11): only the recipe, never the app around it (usernames, likes, comments,
  hashtags, "link in bio", an email's headers and quoted reply); emoji used as bullets or step
  numbers left out; text repeated where screenshots overlap given once; the source is who posted
  or sent it ("june.cooks", "Mom", or as the email is signed). A typed list or numbered steps stay
  as they are.
- Leave a field out when it doesn't matter what's found (no time on the card, say). Use `null` or
  `""` when the right answer is "nothing".
- Small differences are forgiven when scoring: letter case, spacing, curly quotes, `½` against
  `1/2`, bullets and step numbers. Spelling mistakes are not.

## Collecting samples (checklist)

The plan asks for about 30 web pages, 20 card photos, 10 cookbook pages, 10 screenshots, a few
PDFs and a Paprika export. Already in: 31 web pages, 7 cards, 2 cookbook pages, 5 screenshot
recipes (8 images) and 3 PDFs.

- [x] **Web pages (about 30):** 31 pages from your Paprika library (E3), chosen for variety: big
      sites, paywalled ones, blogs on each common recipe card, sections, metric amounts,
      microdata. Still worth adding by hand: pages from Food Network (most of your library),
      Allrecipes and Serious Eats, which refuse automated downloads; a page with two recipes; and
      a few with no recipe data at all, for the AI reader (E8).
- [ ] **Card photos (about 13 more):** printed and handwritten, faded, stained, cursive, both
      sides of a card (front and back as two files of one sample), two recipes on one card, and a
      couple taken badly (angled, shadowed, blurry).
- [ ] **Cookbook pages (about 8 more):** a recipe across two pages, two recipes on one page,
      columns, a photo behind the text, metric and imperial, and a recipe that points to another.
- [ ] **Screenshots (about 6 more):** a web page cut across three screenshots; and, made by Fennl
      for the test set (E11, a generic app, no real account), a social media caption in two
      overlapping screenshots, a text-message conversation and an email. One real one is in: a
      magazine app on your iPad (`french-onion-soup-screenshot`). Still worth adding: real ones
      from your phone (Instagram or Facebook captions, messages, emails, notes), and from a
      computer.
- [ ] **PDFs (a few more):** two scanned book chapters, and, made by Fennl for the test set
      (E12, invented recipes), a family cookbook of three recipes made on a computer, one running
      on to the next page (`family-cookbook-pdf`). Still worth adding: a printed-to-PDF web page,
      a scanned family cookbook of several recipes, and a real PDF of several recipes. A PDF is
      read as the app reads it: its recipes found first, then each read from its pages.
- [x] **Paprika export:** the owner's whole library (827 recipes) is in
      `test_recipes/all-recipes.paprikarecipes`. E2 reads every ingredient line in it
      (`ingredients.test.ts`); E13 will import it.

For each new sample, add it to `samples.json` and the file to `test_images/`, and I'll write the
first draft of its correct answer for you to check.

## Which sites are read (marketing list)

`sites.json` lists the recipe sites Fennl advertises (Paprika's list, plus sites found since; add new ones
there). `npm run import:check-sites [domain ...]` finds a recipe page on each, runs the web importer over
it, and rewrites `sites-status.json` and `docs/marketing/supported-sites.md`. It needs the network and
takes a few minutes, so it is not part of CI. Sites that refuse a script's download are listed as not
checked; check them by hand in a browser with the extension.
