# What Paprika users complain about and ask for

Researched 2026-10-13 to check Fennl's plan against real requests. Companion to `2026-10-13-paprika-4-parity.md` (which compares against Paprika's own announcement).

## How good is this evidence? (read first)

- **Reddit could not be read.** Reddit blocks this environment at the network level (a normal headless Chromium got "You've been blocked by network security"; the fetch tool and plain requests were refused too). I did not try to get around the block. **No Reddit threads were read.** Search engines returned none either. To close this gap, the owner can paste threads, or search Reddit from a normal browser (r/PaprikaApp, r/recipes, r/mealprep, r/mac, r/selfhosted; search "Paprika" plus "wish", "missing", "alternative", "Paprika 4").
- **What was read instead:** aggregated App Store review pages ([justuseapp](https://justuseapp.com/en/app/1303222868/paprika-recipe-manager-3/reviews), [complaintsboard](https://www.complaintsboard.com/paprika-recipe-manager-3-b149019)), a long-running blog comment thread ([reluctantgourmet](https://reluctantgourmet.com/paprika-recipe-manager-review/), 2014–2025), a [Home Assistant feature request](https://community.home-assistant.io/t/paprika-recipe-integration/508354), a [Slickdeals thread](https://slickdeals.net/f/16213756-paprika-recipe-manager-app-40-50-off-windows-mac-android-ios) summarized by search, and competitor blog roundups ([recipeshelf](https://recipeshelf.ai/blog/paprika-alternatives), [Ultimate Meal Plans](https://ultimatemealplans.com/reviews/paprika), [CookBook](https://cookbookmanager.com/post/paprika-4-subscription)).
- **Caveats:** these are small samples, some years old, and the roundups are written by competitors. Treat a theme as real when several independent sources repeat it. Not "exhaustive".

## Themes, and where Fennl stands

Status: **Covered** (built or planned and enough) · **Strengthen** (planned; add the specifics below) · **Gap** (not in the plan) · **Not doing** (decided).

| # | What people say | Fennl | Action |
| --- | --- | --- | --- |
| 1 | **Lost recipes after an update; locked out until buying again; backups not set up.** The loudest theme in the review pages | Covered. Cloud is the source of truth, 30-day database restore, nightly export, export always free, no repurchase | Say it plainly on the sign-up and marketing pages (H5) |
| 2 | **Pay again per platform; no real web app; no Windows; "web is an afterthought"** | Covered. One web app on every device | None |
| 3 | **Support is "a glorified FAQ"; no human; refunds ignored** | Partly. In-app feedback form with an admin inbox (B8) | Strengthen: a stated reply time in the tester guide (H5); keep the inbox visible to the owner |
| 4 | **Sync trouble:** duplicates, slow grocery list, recipes missing after upgrade | Covered by design (IDs, `server_seq`, per-field merge) | Keep sync status visible (built in C4); two-device tests in G1 |
| 5 | **Import:** web import needs manual field selection; many sites stopped working; photo of a recipe doesn't fill it in; PDFs/images wanted | Covered: E3, E5–E6, E8–E12 | None |
| 6 | **Other apps' data gets stranded:** can't move recipes from MasterCook etc. in, or out to Evernote/others | Out is covered (HTML + JSON export). **In is Paprika-only** | **Gap: importers for other apps** (new candidate **E16**, below) |
| 7 | **Scaling and conversion bugs:** "16 oz" doubled to "2 bags (16 oz)"; 16 Tbsp becomes 1 cup but 8 Tbsp stays; metric conversion treats weights as liquid; wants scaling by weight or volume; friendlier units | Strengthen. F1 covers parenthetical weights. Add the specifics to F1's tests (below) | Edit F1 |
| 8 | **Grocery list:** can't merge "1 C / 1 cup / 1 cups"; aisles in the wrong order, deleted aisles return; per-store lists; a master list; swipe to check; real-time sync; print | Not built (post-beta) | Record as requirements for the grocery-list phase (below) |
| 9 | **Pantry:** doesn't talk to the grocery list (10 tortillas "in stock" when short 5); storage locations; barcode; low-stock; brand/notes; quantities update when planned | Not built (Stage J) | Record as requirements (below) |
| 10 | **Meal plan:** meals without a recipe; recurring meals; one recipe on several days (leftovers); several recipes per day without opening each; nutrition totals and targets per day; print as a calendar; send to Reminders/calendar | Not built (post-beta) | Record as requirements (below); calendar feed already proposed |
| 11 | **Nutrition:** calculate it; daily totals; total time from prep + cook | F4b (proposed); planner totals; total time is a display detail | Add "total time shown automatically" to C13/C5 notes (below) |
| 12 | **Cook mode:** screen locks while cooking, must touch to check a measurement; wants a "chef's view" with big type; a button to clear all crossed-out items | Covered by F5 (screen stays on, big type, check-offs) | Add "clear all checks" to F5 |
| 13 | **Bulk actions:** select many recipes to delete or move; undo | Partly: C7 has select + add/remove category with Undo | **Strengthen:** bulk Delete (to Trash), Export selected, and Share on the same select bar (C13 or a small C7 follow-up) |
| 14 | **Compare recipes side by side; duplicate-entry alerts** | C14 (compare, duplicates), E4 (alert at import) | None |
| 15 | **Sharing:** send a recipe by text/email to people who don't use the app; shared account means one login | Partly. Household has separate logins (better). G4 sends to Fennl users only | **Gap: share a single recipe by read-only link** with non-users (add to G3/G4 scope) |
| 16 | **Print:** more layouts; print the grocery list; calendar print | F6 print view | Strengthen: layout choices (compact, large type, with/without photo/notes) in F6 |
| 17 | **Photos:** inserting a photo fails; zoom on photos | D2 built; viewer | Check zoom/lightbox exists; add if missing |
| 18 | **Notes:** margin notes; unstar | Notes + personal opinions exist | Low priority: per-step notes (candidate, not planned) |
| 19 | **Dietary tags** aren't automatic | E3 reads diet labels from pages | Low priority: suggest tags from ingredients (candidate; AI cost) |
| 20 | **Integrations:** Home Assistant, Grocy, Todoist, MagicMirror users want the meal plan and grocery list out; there's no official API | Not planned. Calendar feed (proposed) gives a read-only meal plan | Candidate: a documented personal API token, later |
| 21 | **Voice, Apple Watch, Alexa** | Decided not to match (2026-10-13) | None |
| 22 | **Price/licensing:** one price for all devices; loyalty price for existing owners; anger at paid upgrades | Fennl is one subscription for all devices | Owner's business call: an introductory offer for Paprika owners via a Stripe promotion code (Stage I). Not a code change |
| 23 | **Privacy:** ads in the in-app browser; "business partners" in the terms | Fennl has no ads; H2 privacy policy | Keep the policy plain; state AI vendor retention (already planned) |
| 24 | **Dated design; no AI help; no ready-made meal plans** (competitor claims) | A4 design done; AI import done. Meal plan *generation* is not Paprika's niche | Candidate only: "suggest dinners from my library" later. Not proposed now |

## Proposed changes (all after the beta; each approved separately)

1. **E16, Import from other apps.** Reader for Schema.org recipe JSON-LD files first (the common denominator), then one or two formats chosen from what beta testers actually bring (candidates: Mela, Crouton, Recipe Keeper, MasterCook, Plan to Eat export, Mealie/Tandoor). Same draft format and review screen as every import. Pick formats by asking testers, not guessing.
2. **F1 test additions** (existing phase, still to be built): parenthetical weights must scale with the amount ("1 bag (16 oz)" doubled stays consistent); friendly rounding ("8 Tbsp" shown as "½ cup"; "16 Tbsp" as "1 cup"); volume-to-weight conversion only where an ingredient's density is known (F4b's USDA portion data can supply it, so build F1 so it can use that later) and never treating weight as liquid; scale by servings, by factor, or "keep this ingredient's amount fixed".
3. **F5 addition:** a "clear all checks" button.
4. **Recipe sharing by link** for people without Fennl (read-only page; the owner can revoke it), in the cookbook/send-to-user phases (G3/G4).
5. **Bulk Delete and Export on the C7 select bar.**
6. **Requirements for the later grocery list, pantry and meal planner phases** (so they're designed to avoid Paprika's complaints):
   - *Grocery list:* merge the same ingredient across unit spellings and plurals using E2's unit table; the list is the one source of truth that every device sees (no slow sync); aisle order per store that stays as the person set it; more than one list per store; swipe to check; print; "I already have it" from the pantry.
   - *Pantry:* the pantry and the list share one set of items, so planning a recipe subtracts what's on hand correctly (10 needed, 5 on hand = buy 5); storage locations; optional barcode (Unverified on iOS); low-stock; brand/notes.
   - *Meal planner:* meals without a recipe; recurring meals; one recipe on several days; several recipes in a day added in one step; per-day nutrition totals (with F4b) and optional targets; print as a calendar; calendar feed.
7. **Open candidates, not proposed now:** per-step notes, suggested diet tags, personal API token, "suggest dinners from my library".

## What Fennl already does that these reviews ask for

Data safety and free export; every platform in one subscription; separate household logins; automatic times in cook mode (timers); searching that holds up at 10,000 recipes; undo on bulk changes; duplicate checks; reading photos and PDFs of recipes; sync that shows its status.

## To do next

- Owner (or a normal browser): collect Reddit threads and paste the interesting ones; I'll fold them into this file.
- Read Paprika's updated User Guides for the "minor improvements" (also listed in the parity file).
