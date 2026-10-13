# Finding out what people really want from a recipe app

Written 2026-10-13. Companion to `2026-10-13-paprika-user-requests.md` and `2026-10-13-paprika-4-parity.md`.

The idea: stated wishes (reviews, forum posts) are one weak signal. The strongest signals are what people **do**, what they **pay for**, what they **work around**, and what they **keep paying for after the novelty ends**. Below: what was run today, what the data said, and a catalogue of further methods ranked by value and effort.

## 1. Run today: mining Apple App Store reviews at scale

Method: Apple's public customer-review feed (no login), 4 countries for Paprika, most-recent and most-helpful sorts. About **4,900 reviews** across Paprika 3 (iOS and Mac, 1,283), Plan to Eat (700), AnyList (827), Samsung Food (465), RecipeBox (483), Mela (307), Pestle (287), Crouton (240), Recipe Keeper (100), ReciMe (100), Mealime (50). Scripts were throwaway (kept in the session scratchpad, not the repo); the reviews themselves aren't republished here.

**Honest limits:** only reviews Apple's feed exposes (about 500 per app and country); skewed toward people motivated enough to write; keyword counts overcount (the word "print" appears in praise too), so the counts below are *mentions*, not requests. I read the actual sentences; the table lists what repeated.

### What repeated in Paprika's own reviews (requests, not praise)

| Request | Evidence | Fennl |
| --- | --- | --- |
| **Search that works**: any words in any order ("Grandma Pie" finds "Grandma's Cinnamon Apple Pie"), accents/apostrophes, **search by ingredient**, search by category, **exclude** a folder/ingredient | Dozens of mentions; "the search function needs a LOT of work" is among the most common 3–4★ lines; Mela users ask for the same | **Already covered by C8** (every word, any order, ignores case and accents, ingredients indexed). C13 adds exclude. This is a selling point to *say out loud* |
| **Get recipes in from social** (Instagram/TikTok/Facebook reels captions), **from a camera/cookbook (OCR)**, **by copy-paste or the share sheet**, **batch import of bookmarks or PDFs** | 63 mentions of social sites alone; the single most common "only thing I wish it did" | Camera/PDF/paste (E9–E12, E15) planned; social after AI import is established; share-into-app via Web Share Target planned. **Add: batch import of many links at once** (new, below) |
| **Better grocery list**: multiple stores (merged view too), aisle order, select/delete all completed, merge "1 C / 1 cup" | Repeated in Paprika, Mela and AnyList reviews | Requirements already recorded; add "merged view across stores" |
| **Meal plan**: meals without a recipe ("leftovers", "taco night"); one recipe on several days; labels/colors; duration of the recipe instead of a 1-hour calendar block; a **calendar feed** instead of manual export | Repeated; calendar-duration complaint is from Mela | Requirements recorded; add "calendar events last as long as prep + cook" |
| **Print and cookbook**: print all recipes in a category as a cookbook; print layout options (paper sizes, toggle photo, 4×6 cards, selectable text) | Print/cookbook mentions are the largest keyword group; Mela's 2★ reviews are mostly print toggles | F6 print view planned; cookbooks (G3). **Add: print/PDF a whole category or cookbook; paper sizes including 4×6 cards; photo on/off** |
| **Tags** (and filtering by two at once: "soup" AND "vegan"); rename/delete a tag from its own view; fast switch | Paprika and Mela reviews both | Fennl has nested categories with several per recipe, which do the same job. C13 must make "two categories at once" and "none of these" easy. **Not adding a separate tags system** |
| **Pantry**: barcode, locations, fridge/freezer with dates ("track what's in my fridge & freezer, with dates prepared") | Barcode 9 mentions; fridge/freezer tracking repeated | Stage J; "leftovers with a date" is a new idea (below) |
| **Cook mode**: live timers in the directions, Dynamic Island/lock-screen timer, ingredients and steps side by side in landscape | Mela reviewers miss Paprika's live timers; landscape two-panel praised | F5 covers timers and two-panel; check that a timer survives leaving the app (web limits: notifications) |
| **Scale/convert**: show grams, a conversion calculator and chart | Repeated | F1; add a standalone unit converter (cheap and handy) |
| **Nutrition**, **macros**, "works with My Fitness Pal" | 29 mentions | F4b; export of nutrition |
| **Rating and favorites per recipe**, **random recipe button**, **"what should I cook?"**, **recommended feeds** | Mela: "random recipe button", "recommended feeds"; Paprika: suggestions | Rating exists. **New: a "Surprise me" / "Something I haven't made in a while" button** using last-made data (no AI, fully on the device) |
| **Safety against accidental deletion; sync visibility ("Sync Now" button; counts differ between devices)** | Mela 3★ | Trash (C9) and sync status exist; add a manual "Sync now" |
| **AI / MCP connector** (one Paprika reviewer: "an MCP connector would be amazing"), AI import | Few, but notable | AI import planned. **Candidate: a read-only API token / MCP connector** so a person can ask their own assistant "what can I cook with what's in my pantry?" |
| **Preloaded starter recipes** | Seen | Fennl has 4 samples (C5) |
| **Auto-quantity parsing wrong** ("item: apple, quantity: granola bars"); a switch to turn parsing off | One Paprika reviewer, but it is exactly the risk in E2 | Fennl keeps the text as written and re-reads (CLAUDE.md); **add a visible "read as" display the person can correct per line** (E2/F1) |
| **Support unreachable; no reply to refunds/emails** | 12 mentions; appears across Paprika, Mela and RecipeBox | B8 feedback inbox; promise and keep a reply time |
| **Cost/platform**: pay again for Mac; no PC/web (Mela: "Please make a browser/PC version!!") | Repeated | Fennl is web |

### Patterns across competitors (what the market is missing)

- **Plan to Eat, AnyList, Samsung Food** reviews are 55–65% about **grocery list and meal planning**; sharing with a partner is half of AnyList's and 39% of Plan to Eat's. Recipe *storage* alone is not what those people are paying for: **the shared grocery list is the daily-use anchor**. This matters for sequencing (below).
- **Mela's low-star reviews** are dominated by sync/support (34% of its ≤3★ reviews mention support or bugs) and sharing across iCloud accounts that doesn't work. **Real two-person sharing that works is a differentiator**, and Fennl's household is built for it.
- **Recipe Keeper, RecipeBox, ReciMe** low-star reviews: subscription/ads/paywall surprises (ReciMe: 55% of ≤3★ mention price; 40% ads/privacy/AI). People punish surprise paywalls. Fennl's Free tier limits must be visible *before* hitting them (C11 usage bar helps).
- **Hacker News**: people ask for **a clean recipe without the life story and ads** ("strips all the SEO text"), a **single-purpose clip tool** ("Sometimes I just want a recipe once. I don't necessarily want all recipes in my own database"). **Idea:** a "Cook this now" mode from the extension that shows the clean recipe without saving it (save with one click). Not in the plan.

## 2. Methods not yet run (ranked)

Higher value first. "Owner effort" is what Fennl's owner has to do; the aim is as little as possible.

| # | Method | What it reveals | Owner effort | Status |
| --- | --- | --- | --- | --- |
| 1 | **Beta instrumentation for *demand*, privacy-safe** (see "Telemetry" below). Counts only, no recipe text | Which features get used; which searches return nothing; which sites and formats fail to import; which "needs Premium" buttons get tapped; where people stop | One decision (opt-in wording) | Proposed |
| 2 | **Import-failure log by site** (domain only, from the extension) | Exactly which recipe sites people actually clip; the importer's worst gaps ranked by real traffic | None once built | Proposed (E4/E8 extension) |
| 3 | **Zero-result search log** (aggregate, no personal text unless the person opts in) | What people call things that Fennl can't find (synonyms, "gluten free", ingredient names) | None | Proposed |
| 4 | **Fake-door buttons** in the beta: a visible "Send this recipe to a friend", "Add to grocery list", "Share link" that opens "Not built yet. Want it? [Yes]" and counts the taps | Real demand for unbuilt features, measured by behavior, before spending weeks building | None after built | Proposed (small) |
| 5 | **Founder-led import of testers' real libraries**: ask each tester to share (with permission) their Paprika/Mela/Recipe Keeper export file *structure* (counts, categories, fields used, not recipe text) | What people actually keep: how many categories, how many have photos, what fields are filled, how big libraries are, which features they depend on (ratings? "want to cook"? menus?) | One request per tester | Proposed; Fennl's Paprika export research exists (`2026-10-07-paprika-export.md`) |
| 6 | **"Jobs to be done" interviews** (5–8 people, 20 minutes): "Tell me about the last time you cooked something new. What did you do from deciding to eating?" Plus a **switch interview** for each Paprika/Mela refugee ("What made you go looking? What nearly stopped you?") | The real workflow, the trigger events, the anxieties (lost data!), which beat survey answers | Scheduling; a script I can write | Proposed |
| 7 | **Watch someone cook** (screen recording or over the shoulder): kitchen with greasy hands, phone propped, timers, scaling. Even three sessions find things no survey will | Cook-mode needs, readability at arm's length, one-hand use | Ask a family member | Proposed |
| 8 | **Competitor release notes and changelogs** (Paprika, Mela, Crouton, Plan to Eat, Mealie): what they ship repeatedly, and what they remove | What users forced them to fix | None | Partly done (Paprika scaling fixes in 3.7.0–3.8.1); can extend |
| 9 | **GitHub feature requests with vote counts** in open-source recipe apps (Mealie, Tandoor, KitchenOwl, Recipya, Cooklang tools) sorted by reactions | The most *quantified* demand signal, from the most engaged people. Self-hosters skew technical | None, but not reachable from this session (see below) | Needs a session with GitHub API access to those repos |
| 10 | **Reddit, Facebook groups, YouTube comments, TikTok** (r/PaprikaApp, r/recipes, r/MealPrepSunday, r/selfhosted, r/mac; recipe-blogger and "Paprika tips" videos) | Free-text pain in people's own words | Owner reads or exports threads (Reddit blocks this environment) | Blocked here; owner can paste |
| 11 | **Search-intent data**: Google autocomplete and Trends for "paprika app doesn't…", "paprika alternative", "recipe app that…" | What people ask in their moment of frustration | Low | Autocomplete endpoint returned nothing from here; Trends needs a browser |
| 12 | **Willingness to pay**: ask beta testers to choose between plans with real prices (a Van Westendorp or simple "which would you pick" survey) | Price points for Individual vs Household, and for Paprika refugees | One short survey | Proposed before Stage I |
| 13 | **Concierge tests**: do the work by hand for a few testers (e.g., build their weekly grocery list from their recipes) to see if they'd use the feature before building it | Whether a grocery-list/meal-plan phase is worth its cost | Time | Proposed before the grocery phase |
| 14 | **Abandonment signals**: who signs up and never imports; who imports and never returns after day 7; what they did last | Where the first-run experience loses people | None after instrumentation | Proposed |
| 15 | **Support-ticket mining**: tag every feedback message (B8 inbox) by theme; review weekly | Continuous, free, in the app | Small, weekly | Already built (tag themes in the admin inbox) |
| 16 | **"Wish list" box in the app** (one question at the end of a cooking session: "What would have made that easier?") | Context-rich requests tied to a moment | Small decision | Proposed |

### Telemetry (needs an owner decision; touches the privacy policy)

Fennl is local-first and says recipes live in the account, never the browser. Any measurement must keep that spirit:
- **Opt-in**, off by default, one plain sentence in the first-run flow and in Settings.
- **Counts and categories only**: never recipe text, ingredient text or search words (except a zero-result word the person chooses to send).
- Stored in the existing D1 database or Cloudflare analytics; no third-party tracker.
- Described in the privacy policy (H2) before the first external tester sees it.
This is a **Decision for the owner** and is not built.

## 3. What changed in the plan from this research

Recorded in `spec.md` (candidate items, not approved):
- **C13**: also "none of these" filters, two categories at once, search from any screen; "Surprise me" / "Something I haven't made in a while".
- **E4/E5 (extension)**: "Cook this now" without saving; a list of sites that failed (domain only) for the owner.
- **E15 (paste)** and a new **E17: import many links at once** (paste a list of addresses or pick browser bookmarks), because Paprika users ask for batch bookmark import.
- **F1/F5**: a standalone unit converter, "read as" per ingredient line, a timer that keeps working when the tab isn't in front (with notification, where the browser allows).
- **F6**: print or PDF a whole category or cookbook; paper sizes including 4×6 cards; photo on/off.
- **Grocery/planner requirements**: merged view across stores; calendar events as long as prep + cook; labels/colors for meals; "leftovers" entries with a date.
- **Sequencing insight**: for many users, the *shared grocery list* is the daily anchor (Plan to Eat, AnyList, Mealime: 55–70% of reviews mention it). The grocery list and meal planner should come soon after the beta, **before** cookbooks (G3) and send-to-user (G4). Owner's call; not changed yet.
- **Candidate, later**: read-only API token / MCP connector.
- **Beta tooling to decide**: opt-in telemetry; fake-door buttons; a one-question wish-list prompt.
