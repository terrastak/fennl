# Where recipes live on the server (2026-10-07)

Phase C1, open question 7 in `CLAUDE.md`. Facts checked against Cloudflare's documentation on 2026-10-07.

## The facts

| | D1 | Durable Object (SQLite-backed), one per household |
| --- | --- | --- |
| Size | 10 GB per database (Workers Paid); 50,000 databases and 1 TB per account | 10 GB per object; unlimited objects and storage per account |
| Largest row | 2 MB | 2 MB |
| Throughput | "Each individual D1 database is inherently single-threaded": about 1,000 queries a second at 1 ms each | Soft limit of 1,000 requests a second per object |
| Price (Workers Paid) | 25 billion rows read and 50 million rows written a month included; 5 GB included, then $0.75/GB-month | Billed per request, duration and storage (not needed for the comparison) |
| Preview links | Work as now | "Version URLs are not generated for Workers that implement a Durable Object" |
| Scaling advice | "D1 is designed for horizontal scale out across multiple, smaller (10 GB) databases, such as per-user, per-tenant or per-entity databases." | One object per entity |
| Backups | Time Travel: any minute in the last 30 days, restoring the whole database | 30-day point-in-time recovery per object |

Sources: [D1 limits](https://developers.cloudflare.com/d1/platform/limits/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [Durable Object limits](https://developers.cloudflare.com/durable-objects/platform/limits/), [Preview URLs](https://developers.cloudflare.com/workers/configuration/previews/).

## Sizing

The owner's real library is 827 recipes. A recipe's text is a few kilobytes (3 to 4 KB for the fuller recipes in the sample, without photos), so a library that size is roughly 3 to 4 MB of text once each line's ID is added. Note that this is about the Free plan's 3 MB text limit. Photos are in R2, not here. Plan text limits are 3 MB (Free), 50 MB (Individual) and 100 MB (Household). A 10 GB database holds about 2,500 libraries that size, and many more typical ones.

## Decision: D1

Recipes, categories, photos, opinions and "made it" records are tables in D1, in the same database as accounts for now.

- **It fits the ownership model.** Recipes belong to a person; households only grant visibility. Joining or leaving a household changes no recipe rows. A per-household Durable Object would be a container, and every join or split would mean copying data between objects.
- **Preview links keep working.** A Worker with a Durable Object gets no version (preview) URLs, which every phase's review relies on.
- **One place for the admin console and nightly exports**, using the same queries and tools as the rest of the app.
- **Room to grow:** when recipe data nears a few GB, recipes move to their own databases split by owner, as Cloudflare recommends. Everything is keyed by owner already, so the move is mechanical.
- A Durable Object per household stays an option for live updates between devices later (`CLAUDE.md`, sync Phase 2), as a coordinator only, not as the store.
