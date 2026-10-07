# Browser storage trial results (phase C2)

The test page is `/storage-trial` (on a preview link or the live site). It needs no sign-in and only stores made-up recipes. Each run's "Copy results" text is below, one block per device.

The question: does SQLite in the browser (`@sqlite.org/sqlite-wasm`, `opfs-sahpool` storage) work well enough on the devices Fennl's users have? If not, the fallback is IndexedDB via Dexie (`CLAUDE.md`, "Stack").

## Answer

**Yes. Keep SQLite on OPFS.** On every real device it saved, searched, survived closing, and refused a second tab safely. Every search took under 15 ms, even with 20,000 recipes (about 25 times the owner's 827-recipe library). There is no reason to fall back to Dexie.

| Device | Write 10,000 | Searches at 10,000 | Searches at 20,000 | Kept after closing | Second tab blocked | Browser agreed to keep storage |
| --- | --- | --- | --- | --- | --- | --- |
| Chrome on Mac, tab | 1.6 s | 3 to 6 ms | 5 to 11 ms | Yes (reload) | Yes, and took over after the first closed | Yes |
| Safari on iPhone (iOS 27), home screen app | 0.8 s | 1 to 3 ms | 3 to 6 ms | Yes (app force-closed) | Not applicable (one window) | Yes |
| Firefox on Mac, tab | 2.2 s | 4 to 8 ms | 6 to 13 ms | Yes | Yes, "Try again" worked after the first closed | Yes, after Firefox's own permission prompt |
| Edge on Windows 11, tab | 1.7 s | 2 to 5 ms | 4 to 9 ms | Yes | Yes, "Try again" worked after the first closed | **No** |

Listing 50 by title and opening one recipe took under 1 ms everywhere (Safari and Firefox round their timers to whole milliseconds, so "0.0 ms" means under 1 ms).

## What this means for later phases

- **Persistent storage is not guaranteed in a browser tab.** Edge said no, Chrome said yes. Chromium decides by heuristics, probably how much the person has used the site (the owner had used `beta.fennl.app` in Chrome for days; Edge had never seen it). Firefox asks the person. iPhone home-screen apps were granted. This fits the core rule that the cloud is the source of truth: a browser that won't promise to keep the copy only costs a re-download. For Premium offline editing, the app should encourage installing to the home screen or dock, where storage is kept (C4).
- **Only one tab can open the database.** All browsers that were checked refused a second tab while the first held it. The real app can't just refuse a second tab, so C4 needs one tab to own the database and the others to work through it (or straight from the server), with ownership passing on when that tab closes. The trial showed the handover works.
- **A home-screen app has no reload button** (owner, iOS 27). The real app needs its own "A new version is ready" prompt when a new release is deployed (C4).
- **Space used is about 3.5 times the recipe text** in Chromium and Safari (the search index, plus spare room the storage keeps for itself), and under 2 times in Firefox. The owner's library (about 4 MB of text) would take about 15 MB on a device. Every device offered at least 10 GB; Firefox raised its offer from 10 GB to 463 GB once storage was kept.
- **Opening is quick.** Loading SQLite took 60 to 380 ms (the first visit downloads it, later visits use the browser's cache), and opening the database 7 to 140 ms.

## Not covered

- Safari on Mac, and Safari on iPhone in a browser tab (not from the home screen). Same engine as the iPhone home-screen run, so no surprise is expected; worth a quick look during C4's device testing.
- Android Chrome (no device available). Same engine as Chrome and Edge.
- What happens when site data is cleared: the test recipes are simply gone, which is the case C4's re-download covers. Tested there, with real recipes from the server.
- Safari's 7-day removal of site data in a browser tab can't be tested in one sitting (`CLAUDE.md` unverified item 3). Home-screen apps are exempt.

## Raw results

Each device ran the test twice: once on an empty test box, then again after closing and reopening, which adds 10,000 more.

### Chrome on Mac (browser tab)

The second run followed opening a second tab while the first was open ("Another tab has the test open"), closing the first tab, and reloading the second.

```
Fennl storage test, 10/7/2026, 2:00:19 PM
Device: Chrome on Mac (browser tab)
Storage: 86.0 MB used of 10.1 GB
Kept until cleared: no
SQLite 3.53.4: loaded in 379 ms, opened in 71 ms
Wrote 10,000 recipes in 1.6 s (23.5 MB of text in total)
Recipes in the test box: 10,000
Search chicken: 4.4 ms (8,420 matches)
Search garlic lime: 5.3 ms (8,494 matches)
Search "sour cream": 3.9 ms (5,952 matches)
Search jalapeno: 2.8 ms (6,100 matches)
Search tort*: 5.5 ms (8,651 matches)
List the first 50 by title: 0.2 ms
Open one recipe: 0.1 ms
```

```
Fennl storage test, 10/7/2026, 2:02:12 PM
Device: Chrome on Mac (browser tab)
Storage: 166.0 MB used of 10.2 GB
Kept until cleared: yes
SQLite 3.53.4: loaded in 63 ms, opened in 18 ms
Found from an earlier run: 10,000 recipes
Wrote 10,000 recipes in 1.9 s (47.1 MB of text in total)
Recipes in the test box: 20,000
Search chicken: 7.7 ms (16,750 matches)
Search garlic lime: 10 ms (16,745 matches)
Search "sour cream": 7.2 ms (12,106 matches)
Search jalapeno: 5.1 ms (11,875 matches)
Search tort*: 11 ms (17,369 matches)
List the first 50 by title: 0.3 ms
Open one recipe: 0.0 ms
```

### Safari on iPhone, iOS 27 (home screen app)

Between runs the app was force-closed from the app switcher and reopened from the home screen.

```
Fennl storage test, 10/7/2026, 2:11:57 PM
Device: Safari on iPhone (home screen app)
Storage: 86.1 MB used of 38.4 GB
Kept until cleared: no
SQLite 3.53.4: loaded in 94 ms, opened in 10 ms
Wrote 10,000 recipes in 837 ms (23.5 MB of text in total)
Recipes in the test box: 10,000
Search chicken: 2.0 ms (8,420 matches)
Search garlic lime: 3.0 ms (8,494 matches)
Search "sour cream": 2.0 ms (5,952 matches)
Search jalapeno: 1.0 ms (6,100 matches)
Search tort*: 3.0 ms (8,651 matches)
List the first 50 by title: 0.0 ms
Open one recipe: 0.0 ms
```

```
Fennl storage test, 10/7/2026, 2:13:03 PM
Device: Safari on iPhone (home screen app)
Storage: 205.9 MB used of 38.4 GB
Kept until cleared: yes
SQLite 3.53.4: loaded in 80 ms, opened in 7.0 ms
Found from an earlier run: 10,000 recipes
Wrote 10,000 recipes in 987 ms (47.1 MB of text in total)
Recipes in the test box: 20,000
Search chicken: 5.0 ms (16,750 matches)
Search garlic lime: 6.0 ms (16,745 matches)
Search "sour cream": 4.0 ms (12,106 matches)
Search jalapeno: 3.0 ms (11,875 matches)
Search tort*: 6.0 ms (17,369 matches)
List the first 50 by title: 0.0 ms
Open one recipe: 0.0 ms
```

### Firefox on Mac (browser tab)

A second tab showed "Another tab has the test open"; after the first tab closed, "Try again" opened it.

```
Fennl storage test, 10/7/2026, 3:17:11 PM
Device: Firefox on Mac (browser tab)
Storage: 40.4 MB used of 10.0 GB
Kept until cleared: no
SQLite 3.53.4: loaded in 133 ms, opened in 29 ms
Wrote 10,000 recipes in 2.2 s (23.5 MB of text in total)
Recipes in the test box: 10,000
Search chicken: 6.0 ms (8,420 matches)
Search garlic lime: 8.0 ms (8,494 matches)
Search "sour cream": 5.0 ms (5,952 matches)
Search jalapeno: 4.0 ms (6,100 matches)
Search tort*: 7.0 ms (8,651 matches)
List the first 50 by title: 0.0 ms
Open one recipe: 0.0 ms
```

```
Fennl storage test, 10/7/2026, 3:18:05 PM
Device: Firefox on Mac (browser tab)
Storage: 80.8 MB used of 463.2 GB
Kept until cleared: yes
SQLite 3.53.4: loaded in 64 ms, opened in 13 ms
Found from an earlier run: 10,000 recipes
Wrote 10,000 recipes in 3.0 s (47.1 MB of text in total)
Recipes in the test box: 20,000
Search chicken: 9.0 ms (16,750 matches)
Search garlic lime: 12 ms (16,745 matches)
Search "sour cream": 10 ms (12,106 matches)
Search jalapeno: 6.0 ms (11,875 matches)
Search tort*: 13 ms (17,369 matches)
List the first 50 by title: 1.0 ms
Open one recipe: 0.0 ms
Asked to keep storage: granted
```

### Edge on Windows 11 (browser tab)

A second tab showed "Another tab has the test open"; after the first tab closed, "Try again" opened it.

```
Fennl storage test, 10/7/2026, 3:21:32 PM
Device: Edge on Windows (browser tab)
Storage: 86.0 MB used of 10.1 GB
Kept until cleared: no
SQLite 3.53.4: loaded in 95 ms, opened in 138 ms
Wrote 10,000 recipes in 1.7 s (23.5 MB of text in total)
Recipes in the test box: 10,000
Search chicken: 3.8 ms (8,420 matches)
Search garlic lime: 5.1 ms (8,494 matches)
Search "sour cream": 3.4 ms (5,952 matches)
Search jalapeno: 2.2 ms (6,100 matches)
Search tort*: 4.8 ms (8,651 matches)
List the first 50 by title: 0.2 ms
Open one recipe: 0.1 ms
Asked to keep storage: not granted
```

```
Fennl storage test, 10/7/2026, 3:22:38 PM
Device: Edge on Windows (browser tab)
Storage: 166.0 MB used of 10.2 GB
Kept until cleared: no
SQLite 3.53.4: loaded in 73 ms, opened in 26 ms
Found from an earlier run: 10,000 recipes
Wrote 10,000 recipes in 2.1 s (47.1 MB of text in total)
Recipes in the test box: 20,000
Search chicken: 6.3 ms (16,750 matches)
Search garlic lime: 8.9 ms (16,745 matches)
Search "sour cream": 6.2 ms (12,106 matches)
Search jalapeno: 4.4 ms (11,875 matches)
Search tort*: 9.3 ms (17,369 matches)
List the first 50 by title: 0.2 ms
Open one recipe: 0.1 ms
Asked to keep storage: not granted
```

## Baseline (automated Chromium in the build environment, not a real device)

```
SQLite 3.53.4: loaded in 55 ms, opened in 111 ms
Wrote 10,000 recipes in 14.8 s (23.5 MB of text in total)
Search chicken: 9.2 ms (8,420 matches)
Search garlic lime: 12 ms (8,494 matches)
Search "sour cream": 8.0 ms (5,952 matches)
Search jalapeno: 6.5 ms (6,100 matches)
Search tort*: 11 ms (8,651 matches)
List the first 50 by title: 1.1 ms
Open one recipe: 0.7 ms
```

The build environment writes about ten times slower than real devices, so its timings are a worst case.
