# Native app or web app? (2026-10-07)

The owner asked whether Fennl should have been a native app instead of a web app. This is the reasoning, so the question doesn't have to be re-argued from scratch later. It is a discussion, not a test: nothing here was measured, and the Apple rules below are from general knowledge and are **Unverified**.

## Answer

**Stay with the web app.** Native only wins on a few specific points, and the beta should show whether any of them actually hurt. If they do, add a native wrapper later rather than rewriting.

## Why the web fits Fennl

- **The usual web weakness is already handled.** The cloud is the source of truth and the browser copy is a disposable cache (`CLAUDE.md`, "Core principle"). Browser storage eviction costs a re-download and nothing else. SQLite on OPFS was tested on real devices and worked (`2026-10-07-storage-trial.md`).
- **Billing.** Stripe keeps about 97% of each subscription. A native iOS app generally has to sell subscriptions through Apple's in-app purchase, which takes 15 to 30%. Apple's rules on linking out to a web payment page have changed a lot, so don't count on them (Unverified). The household plan credit and split logic is custom Stripe code and would be much harder through Apple's billing.
- **One codebase** on Workers, D1 and Better Auth. Native means Swift and Kotlin, or a cross-platform framework, plus app-store review on every release. That is heavy for a project with one owner who isn't a coder.
- **Beta distribution.** Testers open a link. Native needs TestFlight and Play Console setup.
- **Chrome extension import** is the headline web import path and only exists on the web.

## What native would give, and what it costs

| Native advantage | Matters for Fennl? |
| --- | --- |
| Share-sheet import from the phone | **Yes, the biggest loss.** An installed web app on iOS can't receive shared links. Already deferred until after the beta (`CLAUDE.md`, "Beta scope"). |
| App Store discovery and "it's a real app" perception | Some. A web app depends on Fennl's own marketing. |
| Storage that is never evicted, background sync | Mostly covered by cloud-first. Matters most for Premium offline editing, where an unsynced outbox could be lost. Mitigation: encourage installing to the home screen, where storage is kept (C4). |
| Push notifications | Little needed before the post-beta meal planner. |
| Screen stays on in cook mode | **Not a native advantage.** The Wake Lock API works in current Safari and Chrome. |

## If native becomes necessary

The data model (client UUIDs, tombstones, cloud as source of truth, cache that can be rebuilt) is what a native shell needs too. The cheapest route is wrapping the web app (for example with Capacitor) to get a store listing, share-sheet import and reliable storage without a rewrite. The catch is that a store build brings in the in-app purchase rules above, so the billing question has to be settled first.

## Signals to watch in the beta

Reopen this question if testers repeatedly report any of:

- Wanting to send a recipe to Fennl from their phone's share button.
- Lost or missing local data on iPhone or in browser tabs, beyond a re-download.
- Not trusting or not finding Fennl because it isn't in an app store.
- Premium offline edits getting lost before they sync.

Without that feedback, there is no evidence yet that the web choice is wrong.
