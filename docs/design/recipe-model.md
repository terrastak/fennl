# What a recipe is

Phase C1, agreed with the owner on 2026-10-07. This is the plain-English version; the same thing in code is `shared/recipe.ts` (with the text-box rules in `shared/recipeLines.ts`).

## What you see and type

| Part | What it holds |
| --- | --- |
| **Title** | The recipe's name. The only required part. |
| **Description** | A short introduction ("Grandma's Sunday rolls, doubled for holidays"). |
| **Ingredients** | One text box, one ingredient per line, typed or pasted in one go. Section headings ("For the crust:") sit between lines. Optionally, a line links to another recipe ("1 cup BBQ sauce" → your BBQ sauce). |
| **Directions** | One text box, one step per line or paragraph, with section headings too. |
| **Times** | Prep, cook and total, as minutes, plus words when minutes aren't enough ("plus overnight rest"). |
| **Servings and yield** | A number of servings (8), which scaling uses, and a yield in words ("2 loaves", "about 24 cookies"). |
| **Source** | What kind (website, cookbook, person, other), its name, link, author, and cookbook page. A person's name ("Aunt June") is shown handwritten. |
| **Notes** | One Notes section: notes that came with the recipe first, then each person's own note, signed with their name. |
| **Rating and favorite** | Each person's own: 1 to 5 stars, and a favorite heart. |
| **Difficulty** | Easy, medium or hard (other wording from an import is kept as written). |
| **Nutrition** | Per serving: calories, fat, saturated fat, carbs, fiber, sugar, protein, sodium, cholesterol. Each value remembers where it came from, and imported nutrition text is kept too. |
| **Categories** | Nested ("Desserts › Cakes"), as many as you like, and used for everything: cuisine, course, status ("Untested"), and diet labels under **Diet** ("Diet › Gluten-free"). Imports add diet labels automatically when a recipe lists them. |
| **Photos** | Several per recipe, one of them the cover. Original card or page scans from an import are kept, marked as import originals, and kept out of the main gallery. |
| **Last made** | "Made it" from the end of cook mode (one tap) or a button on the recipe page. One date for the household, with who made it: "Last made Oct 3 by Sarah". |

## Editing ingredients and directions

- You always edit a plain text box. It comes back exactly as you left it.
- When you save, Fennl splits the text into lines and reads each ingredient (amount, unit, ingredient, note) for scaling and converting. If it misreads a line, nothing is lost: the text is what you see, and you fix a misread by editing the text.
- Pasted bullets, checkboxes and step numbers ("•", "▢", "1.", "Step 2:") are cleaned off, and blank lines dropped.
- **Headings:** a line ending with a colon and no amount ("For the crust:"), or a short ALL-CAPS line with no amount ("CHICKEN"), is a heading. A heading button can also make any line a heading, or not one, and that choice sticks.
- A small preview under the box shows how each line was understood, with "Link a recipe" on each ingredient.
- A linked recipe stays attached to its line when you edit the box: a lightly edited line ("1 cup" → "1½ cups BBQ sauce") is recognised as the same line. Deleting the line removes its link.

## In a household

- Recipes are shared; each still has one owner, the person who added it ("Added by Brian").
- **Ratings, favorites and personal notes belong to each person**, and everyone in the household sees them when there's something to see: "★★★★ Brian · ★★★ Sarah", "Brian's favorite", signed notes. Nothing shows when nobody has rated or noted.
- "Last made" is shared, with who made it.
- When two people edit the same recipe at the same time, the later change wins **part by part**: your title change and your partner's notes change both stay. If you both edit the same ingredient list at once, the later save wins for the whole list (version history can bring the other back). Every line has its own ID, so line-by-line merging can come later without changing any recipe.

## From Paprika

Every field Paprika 3 exports has a place (checked against a real export on 2026-10-07; details in `docs/research/2026-10-07-paprika-export.md`):

- Name, description, ingredients, directions, servings, times, difficulty, rating, source, link, photo, categories, and the date created all map across.
- Paprika's notes come in as **your signed notes** (most Paprika notes are personal).
- Free-text times ("6 hr 20 min"), servings ("Serves 8 to 10") and nutrition are read into numbers where possible; the original wording is always kept.
- Paprika's ID and fingerprint are kept, so importing again updates recipes instead of duplicating them, and only the ones changed in Paprika.
- Not in Paprika's export: favorites, pinned recipes, Trash. Favorites need marking again in Fennl.

## Limits

- The account's text limits and the per-recipe size limit are plan limits, set in the admin console.
- Format rules stop broken data, not normal use: titles up to 200 characters, lines up to 2,000 characters, up to 500 lines per list, times up to a month.

## Behind the scenes

Each recipe also records: its owner and who last changed it, when it was created and changed, when it went to Trash (never truly deleted while it syncs), where an import came from, and, for a copy kept after a household split, the recipe it was copied from.

## Later, by decision

- Line-by-line merging of ingredient and direction lists (households; planned).
- Not planned: equipment, make-ahead and storage fields.
