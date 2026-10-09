# Photo preparation trial results (phase D2)

The test page is `/photo-trial` (on a preview link or the live site). It needs no sign-in, uploads nothing, and prepares photos exactly as the app will (`app/photos/`): turned upright, resized to the D2 limits, and encoded three ways. Each run's "Copy results" text goes below.

The questions:

1. Can every browser make WebP? If not, is a WebAssembly encoder (`@jsquash/webp`, libwebp, Apache-2.0) fast and stable enough on an iPhone?
2. Do camera photos come out upright, without their location?
3. How sharp is a live camera view inside a web page, compared with the phone's own camera?

## Answer so far (2026-10-09)

**Use the WebAssembly WebP encoder on every browser.** Safari's own canvas can't make WebP (asked for WebP, it gives a PNG about twice the size of the original photo). The WebAssembly encoder took under half a second for a cookbook page on an iPhone 18 Pro, and Safari's JPEG at the same quality was 1.7 to 1.9 times its size. The browser's JPEG stays only as a fallback if the encoder can't load.

| Device | Photo | Opened (24.5 MP) | Browser WebP | Browser JPEG | WebAssembly WebP | Upright, no location |
| --- | --- | --- | --- | --- | --- | --- |
| Safari on iPhone 18 Pro, tab | IMG_0019 (page) | 1.8 s | Not available: PNG, 11.2 MB | 2.5 MB, 38 ms | **1.5 MB, 497 ms** | Yes |
| Safari on iPhone 18 Pro, tab | IMG_0020 (page) | 1.8 s | Not available: PNG, 10.8 MB | 2.1 MB, 34 ms | **1.1 MB, 419 ms** | Yes |
| Chromium on Linux (CI-like server) | IMG_0019 (page) | 0.1 s | 1.7 MB, 1.9 s | 1.9 MB, 100 ms | 1.7 MB, 1.6 s | Yes |
| Chromium on Linux (CI-like server) | IMG_0020 (page) | 0.7 s | 1.4 MB, 2.3 s | 1.6 MB, 100 ms | 1.4 MB, 1.1 s | Yes |

Pages are resized to 2250×3000 (the 3000 px page limit) at quality 0.9.

## What this means for D2

- **One encoder everywhere:** the WebAssembly WebP encoder, in a background worker. Never ask a canvas for WebP; on Safari it silently becomes a huge PNG.
- **Opening a 24.5 MP photo is the slow step on an iPhone** (about 1.8 s; resizing and encoding take another half second). One photo feels fine; a multi-page recipe or a batch import needs visible progress, one photo at a time.
- **Upright and private:** drawing through an `<img>` turned both sideways-stored photos upright, and only pixels are uploaded, so their location never left the phone.

## Still to run

- "Take a photo" from inside the page (the phone's camera, opened by Fennl), in a Safari tab and as a Home Screen app.
- The live camera check (resolution of a picture taken from a live view), in both.
- A food photo (the 2400 px, quality 0.85 setting).
- Safari and Chrome on a Mac.

## Results as sent

```
Fennl photo test, 10/9/2026, 3:08:26 PM
Device: Safari on iPhone (browser tab)
Browser makes WebP: no

IMG_0019.jpeg (chosen, treated as a page)
  Original: image/jpeg, 6.5 MB, 5712×4284 stored, turn 6, location yes
  Opened: 4284×5712 in 1.8 s, turned upright
  Resized: 2250×3000 in 41 ms
  Browser WebP: not available (gave image/png, 11.2 MB)
  Browser JPEG: 2.5 MB in 38 ms
  WebAssembly WebP: 1.5 MB in 497 ms
  Upload: the prepared version

IMG_0020.jpeg (chosen, treated as a page)
  Original: image/jpeg, 5.5 MB, 5712×4284 stored, turn 6, location yes
  Opened: 4284×5712 in 1.8 s, turned upright
  Resized: 2250×3000 in 43 ms
  Browser WebP: not available (gave image/png, 10.8 MB)
  Browser JPEG: 2.1 MB in 34 ms
  WebAssembly WebP: 1.1 MB in 419 ms
  Upload: the prepared version
```
