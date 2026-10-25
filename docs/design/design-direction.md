# Fennl design direction

Chosen in phase A4 (2026-10-03) after four mockup directions and several refinement rounds. The mockups live on the owner's private design canvas ("Fennl design directions"). This file records what was chosen, and `app/styles/tokens.css` is where it lives in code.

## The feel

Modern and professional, but warm, because recipes are part of the family. It should never feel like "just another database app". It started from the **Harbor** direction (sidebar layout, warm paper, navy accent) and added a light handwritten touch from the **Heirloom** direction.

## Type

All three fonts are self-hosted (`public/fonts`, `app/styles/fonts.css`, Latin and Latin Extended only): nothing loads from Google, and they work offline in the installed app.

| Role | Typeface | Settings | Used for |
| --- | --- | --- | --- |
| Headings | **Commissioner**, flared | Flair axis `FLAR` 80; weight 540 (just under semibold); italic intros at weight 400 | Logo wordmark, page and recipe titles, section headings, step numbers |
| Everything else | **Instrument Sans** | 400–600 | Body text, labels, buttons, ingredient lists |
| Handwritten touches | **Caveat** | 500, in the scheme's warm "hand" color | People's names, greetings, photo captions, family notes |

Fonts tried and set aside: Fraunces (too serif), Ysabeau Office (too sans), Rosario, Alegreya Sans.

### Handwriting rules

Caveat is a flourish, used only where a person's voice belongs:

- A recipe's source is just the person's name: **June**, **Rose**, **Dad**, **Nana**. No "from" prefix.
- Greetings above page titles ("Good evening, the Lees", "make it feel like home") use the `.hand-note` style: tilted −3°, tucked down against the heading below, hanging a little to the left, **no underline**.
- Photo captions ("Ben's 8th birthday, 2019") and family notes ("June says: double the jam layer…").
- Never for buttons, navigation, ingredients, steps or anything the user needs to read quickly.

## Color schemes

Two schemes, each with light and dark versions. The **color scheme is an account-level setting**: it follows the user to every device.

| Scheme | Accent | Warm and handwriting color | Ground |
| --- | --- | --- | --- |
| **Harbor** (default) | Navy `#24406b` (dark mode `#8fb1e6`) | Coral `#e0664a` / brick `#a8432b` | Warm paper `#f6f5f0` |
| **Heirloom** | Olive `#4f5d2f` (dark mode `#b9c78a`) | Berry `#9a3b4f` | Linen `#f5efe4` |

Light/dark has three choices: Light, Dark, and Match my device (the default).

Every scheme defines the same set of color tokens. `app/styles/tokens.test.ts` checks that, and checks that the main text/background pairs meet WCAG AA contrast (4.5:1) in all four combinations.

## Layout patterns (from the mockups)

- **Desktop:** a left sidebar (logo, "Add a recipe", navigation, categories, a "saved to your account" note), with content to the right.
- **Phone:** a full-width photo at the top, content in a sheet that slides over it, and a "Start cooking" button plus bottom tab bar (Recipes, Search, Import, You).
- **Recipe cards** (reworked 2026-10-25, `spec.md` U2): the photo (4:3; square and two across on a phone) with the title in Commissioner and the time under it, no box around them; a heart on favorites; a recipe with no photo gets a warm card with a sprig of fennel.
- **Recipe list** (2026-10-25, `spec.md` U2): "Your recipes" with Add recipe and a ⋯ menu; quick choices (All, Favorites, 30 minutes or less, Made recently, Not tried yet) and Filters; the count with Surprise me and Sort by kept small. On a computer the categories are in the sidebar and the sidebar's search is the one search; a phone has a search box under the heading.
- **Recipe page** (reworked 2026-10-24, owner's choices; `spec.md` U1): on a computer the cover photo is framed beside the title block (categories small above the title, the title, the person's name in Caveat, Prep · Cook · Makes between two rules, **Start cooking** and **Made it today**), over Fennl's own painting of the photo in brush strokes, softened and fading out with no edge; on a phone the photo fills the top and fades into the page colour, with the title over the fade and no painting. "All 4 photos" on the cover when there are more. Ingredients in a card on the left with **Serves − 4 +** and **Adjust** (amount, pan, units), numbered method on the right.
- **Import review:** the original photo on the left (kept with the recipe); the draft on the right, with uncertain items highlighted in the warm color and a short note; nothing is saved until the user chooses.
- **Settings › Appearance:** color scheme cards with a preview, a Light/Dark/Match-my-device switch, and text size.

## Empty states (preferred pattern, chosen 2026-10-03)

Quiet, not a loud card. Centered on the page with no card or box around it:

- A faint, fading grid of ghosted recipe-card outlines behind the text (hairline borders, a very light fill, fading out toward the bottom), so the page shows what it will become. It must not look like a loading skeleton, so no animation.
- A soft patch of the page color behind the text so it stays readable over the grid.
- A small Caveat greeting, a Commissioner heading ("Your recipe box is empty, for now"), one line of body text, then two buttons: **Add recipe** (filled accent) and **Import** (outlined).
- Copy is an invitation, not an apology. Use tokens for all colors, fonts and sizes.
- Reuse this pattern for other empty screens (categories, search with no results), with the text and buttons changed.
- Import is shown to everyone. What it offers depends on the entitlement flags (see `CLAUDE.md`, "Import sources").

## Logo

Working mark: a filled circle in the accent color with a white fennel frond, next to "Fennl" set in Commissioner. Final logo is still open.

## Open

- **Final logo.**
- **Text size setting:** stored per device (leaning; screens differ).
