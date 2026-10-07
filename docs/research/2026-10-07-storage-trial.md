# Browser storage trial results (phase C2)

The test page is `/storage-trial` (on a preview link or the live site). It needs no sign-in and only stores made-up recipes. Each run's "Copy results" text goes below, one block per device.

The question: does SQLite in the browser (`@sqlite.org/sqlite-wasm`, `opfs-sahpool` storage) work well enough on the devices Fennl's users have? If not, the fallback is IndexedDB via Dexie (`CLAUDE.md`, "Stack").

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

## Owner's devices

To be filled in: desktop Chrome, Safari on Mac, iPhone Safari (browser tab and home screen app), Android Chrome.
