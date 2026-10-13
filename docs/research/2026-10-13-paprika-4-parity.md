# Paprika 4 parity tracker

Source: <https://www.paprikaapp.com/news/2026/09/28/paprika-4-is-now-in-open-beta/> (announcement of 2026-09-28; read 2026-10-13). The page was read through a summarizing fetch, so wording and details (for example how many people "family sharing" allows) are **Unverified** until checked against Paprika's updated User Guides, which the post says hold the full change list. No prices or tiers are given, only that "premium features will require a subscription" after the beta.

**Rule for this file:** every Paprika 4 feature below must end up as *Covered* (planned or built in Fennl) or *Decided not to match* (owner's call, with the reason). Nothing stays "Gap" once the owner has reviewed. Fennl's plan is "at least this, ideally better".

Status: **Built** · **Planned** (in `spec.md` already) · **Gap** (not in the plan; proposed phase named) · **Platform** (needs a web-specific answer).

## Feature table

| # | Paprika 4 feature | Fennl today | Status | Proposed Fennl answer (aim: better) |
| --- | --- | --- | --- | --- |
| 1 | Recipe scanning (photo of a cookbook page or card) | E9–E10: photo capture, handwritten cards, printed multi-page | Planned | Already goes further: front/back cards, multi-card, multi-page, originals kept, review before save, measured accuracy, "Read again" |
| 2 | Social media import (TikTok, Instagram, Facebook, YouTube) | Stage I item 8, after the beta | Planned (late) | Paprika 4 ships this in its beta. Consider pulling forward to the first post-beta set. Method (captions, transcripts, video frames) is Open and needs a legal/terms check per site |
| 3 | Clipboard import (paste text from email, document, message) | Not in the plan. Stage I item 4 is paste-a-link only | **Gap** | New phase **E15**: paste text (or a link) into an Import box; AI reads it into a draft (`import_ai_enabled`); same review screen. Cheap: reuses E7/E8, text-only AI call. Also lets phone users import without the share button |
| 4 | Cookbooks (group recipes, share with other Paprika users) | Categories only (C7); no collections or sharing outside the household | **Gap** | New phase **G3**: named cookbooks (a recipe can be in many; unlike categories they are curated and ordered). Sharing: read-only link or invite another Fennl user; a shared cookbook shows the owner's current recipes. Better than Paprika: optional public read-only page, sections and an intro, a cookbook PDF/print export (F6) |
| 5 | Advanced search (prep time, servings, rating, categories, combine rules, saved searches) | C8: full-text search plus basic filters (verify in code) | **Gap** (partly) | New phase **C13**: filter builder over times, servings, rating, favorite, categories, source, "made" date, has-photo, ingredients included/excluded, with AND/OR groups; save searches as smart lists. Local SQLite makes this instant and offline |
| 6 | Category suggestions from ingredients | Not planned | **Gap** | Part of C13/E4: suggest the person's *own* existing categories (rules from their library first, AI only if `import_ai_enabled`); never creates categories without asking |
| 7 | Nutritional analysis from USDA data, nutrition label | F4 stores and shows only; Stage I item 10 auto-calculation | Planned (late) | Paprika 4 does the calculation, so this is a parity gap. Proposed: pull Stage I item 10 forward as **F4b**. Use USDA FoodData Central (public domain; license and API terms to be checked, **Unverified**), match using E2's parsed amounts, show per-ingredient matches the person can fix, and say plainly it is an estimate. Better: show the label per serving and per scaled serving |
| 8 | Duplicate finder (library-wide, merge in one step) | E4 checks duplicates at import only (`shared/duplicates.ts`) | **Gap** (partly) | New phase **C14**: scan the library, group likely duplicates (reuse `duplicates.ts`), side-by-side compare, merge keeping chosen fields; the discarded one goes to Trash (undoable for 30 days). Never automatic |
| 9 | Family sharing (separate logins; shared recipes, grocery lists, meal plan) | G1–G1c: 2 members; recipes only | Planned (smaller) | Recipes are covered. Grocery list and meal plan sharing arrive with those features (below). **Open:** Paprika says "family members", possibly more than 2; Fennl's 2-seat Household is **Decided** (CLAUDE.md). Check Paprika's limit; if it is larger, ask the owner whether a larger plan is wanted. Not changed here |
| 10 | Direct messaging (send a recipe to another user, no email or export) | Not planned | **Gap** | New phase **G4**: "Send to a Fennl user" by email: they get an inbox item and can accept (a copy they own, `copied_from` set, photos included) or decline. Works across households. Must be rate-limited and blockable (abuse) |
| 11 | Pantry with extra storage locations (fridge, freezer, cupboard) | Not planned | **Gap** | New stage **J (Pantry)** after grocery list: items with location, quantity, optional expiry; "what can I cook" (recipes by what's on hand); buying from the grocery list adds to the pantry |
| 12 | Pantry barcode scanning (mobile only) | Not planned | **Platform** | Web has `BarcodeDetector` on Chrome/Android only; Safari support is **Unverified**. Plan: use it where present, a WebAssembly scanner elsewhere (new dependency, ask first). Product lookup by barcode needs a data source (Open Food Facts is a candidate; license **Unverified**) |
| 13 | Meal plan calendar feeds (Apple, Google, Outlook) | Meal planner is Stage I item 9, no feeds | **Gap** (with planner) | Part of the meal planner phase: a private, revocable `.ics` URL per household, served by the Worker, read-only. Better: choose what shows (dinner only, all meals), and include the recipe link and the scaled servings |
| 14 | Alexa (grocery items, meal plan, recipes on Echo Show) | Not planned | **Gap** | Needs an Alexa Skill with account linking to Fennl (OAuth against Better Auth, a new auth surface, so security review first). After grocery list and planner exist. Probably Premium. Treat as a late phase with an explicit owner decision on whether to match it |
| 15 | Apple widgets (grocery list, meal planner) | Web app only | **Platform** | A web app can't ship iOS widgets. Fennl is **Decided** web (`docs/research/2026-10-07-native-vs-web.md`). Best web answer: installed-app home-screen shortcuts that open straight to Grocery / Today's meals, and notifications for the day's plan. If native widgets matter, reopen the native question with the owner |
| 16 | Siri and Shortcuts | Web app only | **Platform** | Web has no Siri intents. Answers: a Web Share Target (share text or a link from any app into Fennl, which also covers Stage I item 5), URL schemes that Shortcuts can open, and a documented read-only API token for personal automations (later, with rate limits). Voice add-to-grocery-list comes from Alexa (14) |
| 17 | Spotlight recipe search | Web app only | **Platform** | Not possible from a web app on iOS. Closest: the app's own instant search opened from a home-screen shortcut, plus Chrome/Android app shortcuts. Flag as "Decided not to match" unless native is reopened |
| 18 | Refreshed UI, new icon, minor improvements | A4 design already decided | n/a | Nothing to do. Their guides list "minor improvements": read them and extend this table |
| 19 | Subscription for premium features | Stripe plan in Stage I | Planned | Their price is unknown. Watch it when announced: Fennl's Individual and Household prices are still Open |

## Already in Fennl's plan that Paprika 4 doesn't list (our edge)

Import quality measured on a public test set; review-before-save on every import; original photos kept; Chrome extension that reads logged-in and paywalled pages; per-field conflict handling and offline editing; Trash with 30-day restore; version history (G2); linked sub-recipes (F3); pan-size scaling (F2); cook mode with timers (F5); full export always free; Paprika 3 import (E13).

## Where this changes the plan

1. **Beta scope is not changed.** Everything marked Gap or late is after the invite-only beta, which is **Decided**. None of this is approved to build.
2. **Items worth pulling earlier** (owner's call): clipboard import (E15, small and cheap), advanced search + saved searches (C13), duplicate finder (C14), nutrition calculation (F4b). These four are what testers coming from Paprika will notice first.
3. **Grocery list and meal planner** (Stage I items 9) become the base for calendar feeds, Alexa, widget-like shortcuts, pantry and shared lists. They need detailed phases soon, since five Paprika 4 features hang off them.
4. **Web limits** (items 15–17): Fennl can't match Apple widgets, Siri intents or Spotlight as a web app. That is a product decision, not a bug. See open question 22.

## Decisions needed from the owner

- Which Gap items join the first post-beta set, and in what order?
- Match Paprika on social import timing (it's in their beta)?
- Household size: stay at 2 or offer more after checking what Paprika allows?
- Alexa: match, or skip?
- Native-only features (widgets, Siri, Spotlight): accept the web limits, or reopen native?
