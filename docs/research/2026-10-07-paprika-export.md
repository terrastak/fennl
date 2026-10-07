# The Paprika 3 export file (2026-10-07)

Checked against a real 10-recipe export from the owner's library (the full library is 827 recipes, 39 MB). The file itself isn't kept in the repository. Phase E13 builds the import; this records what the recipe model (C1) must hold.

## Format

- A `.paprikarecipes` file is a **zip archive**. Each entry (`<Recipe name>.paprikarecipe`) is one recipe as **gzip-compressed JSON**.
- Photos are inside the JSON as base64. In this sample the main photo (`photo_data`) is small: 210 to 280 pixels square, 15 to 50 KB. `photo_large` was empty and `photos` (extra photos) was an empty list in every recipe. Still to check: whether recipes with the owner's own photos, or several photos, export larger images.

## Fields

| Paprika field | Example | Goes to |
| --- | --- | --- |
| `uid` | `2254C685-…-00000160100F57F4` | Import: external ID (re-import updates instead of duplicating) |
| `hash` | 64 hex characters; changes when edited in Paprika | Import: external hash (re-import updates only changed recipes) |
| `name` | "Chicken Fajitas With Avocado Crema" | Title |
| `description` | usually empty | Description |
| `ingredients` | one text block, `\n` between lines | Ingredients text box |
| `directions` | one text block; often "1." numbering and blank lines between steps | Directions text box |
| `notes` | free text | The importing person's signed note |
| `nutritional_info` | free text, two styles: "1 serving (1 each) equals 369 calories, 15 g fat (2 g saturated fat)…" and a line list "Calories 200 / Total Fat 5 g / …" | Nutrition values where readable, plus the text |
| `servings` | "8-12", "6 servings", "Yield: 6 servings", "1/2 cup", "Serves 8 to 10", "12" | Servings count where readable, plus the wording as yield |
| `prep_time`, `cook_time`, `total_time` | "20 min", "6 hr 20 min", "5 minutes", "3 hours", often empty | Minutes where readable, plus the wording |
| `difficulty` | "Easy", or empty | Difficulty (other wording kept as text) |
| `rating` | 0 (none) to 5 | The importing person's rating |
| `source` | "Tasteofhome.com", "foodnetwork.com - Ina" | Source name |
| `source_url` | page address | Source link |
| `image_url` | the photo's original address; sometimes an iPhone-only `assets-library://` address | Not kept (the photo itself is) |
| `photo`, `photo_hash`, `photo_data`, `photo_large`, `photos` | file name, hash, base64 JPEG | Photos (cover first) |
| `categories` | list of names: "Mexican", "Entrees", "Untested" | Categories (created by name if missing) |
| `created` | "2015-06-18 17:58:22" | Created date |

Not in the export: favorites, pinned, Trash, Paprika's own scale setting. Categories export as plain names, so it isn't yet known how Paprika exports subcategories.

## Things the recipe model handles because of this

- **Headings** are written both as "AVOCADO CREMA:" and as plain ALL-CAPS lines ("CHICKEN", "TACOS"), in ingredients and directions.
- **Directions** carry "1." numbering and blank lines; a step can start with a label ("1. FOR THE GRAVY: Toast…") and is still a step.
- **Personal remarks** can sit inside a step; they stay where they are.
- **Ingredient wording** to test the ingredient reader against (E2): "1½  teaspoons" (double space), "¾ -1 teaspoon", "1 - 2 cups", "½ - ¾ of a lemon, juiced", "¼ cup + 3 tablespoons", "1 8 ounce can", "1 (14.5-ounce) can", "Juice of 1 lemon", "S & P to taste", "Salt and pepper".
- **Categories double as status labels** ("Untested"), which is why categories cover everything instead of separate tag fields.
