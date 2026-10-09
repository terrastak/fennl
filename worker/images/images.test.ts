import { env } from "cloudflare:test";
import { eq, inArray } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createCode } from "../codes/admin";
import { database } from "../db/client";
import { image, member, organization, premiumGrant, session } from "../db/schema";
import {
  householdOf,
  overrideLimit,
  setUpDatabase,
  signUpConfirmed,
  type Visitor,
} from "../test/visitor";

const db = () => database(env.DB);
let counter = 0;
const id = () => crypto.randomUUID();

beforeAll(async () => {
  await setUpDatabase();
});

interface Person {
  v: Visitor;
  userId: string;
}

async function person(name = "June Lee"): Promise<Person> {
  const v = await signUpConfirmed(
    `${name.split(" ")[0]!.toLowerCase()}-${++counter}@example.com`,
    name,
  );
  return { v, userId: (await v.session())!.user.id };
}

let codes = 0;
/** Premium from a code, as beta testers have it. */
async function premium(p: Person) {
  const code = await createCode(
    db(),
    {
      code: `IMG-${++codes}`,
      label: "Image tests",
      tier: "household",
      access: { forever: true },
      allowsSignUp: true,
      maxUses: null,
      redeemBy: null,
    },
    null,
  );
  const res = await p.v.request("/api/codes/redeem", { body: { code: code.code } });
  expect(res.status).toBe(200);
}

async function premiumPerson(name?: string) {
  const p = await person(name);
  await premium(p);
  return p;
}

/** Two people sharing one household (phase G1 builds joining; here it's set up directly). */
async function share(a: Person, b: Person) {
  const householdId = id();
  await db()
    .insert(organization)
    .values({
      id: householdId,
      name: "Shared",
      slug: `shared-${householdId}`,
      createdAt: new Date(),
    });
  await db()
    .insert(member)
    .values(
      [a, b].map((p) => ({
        id: id(),
        organizationId: householdId,
        userId: p.userId,
        role: p === a ? "owner" : "member",
        createdAt: new Date(),
      })),
    );
  await db()
    .update(session)
    .set({ activeOrganizationId: householdId })
    .where(inArray(session.userId, [a.userId, b.userId]));
}

/** Bytes that start like a JPEG and are different every time (or from `seed`). */
function photo(size = 64, seed = ++counter): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set([0xff, 0xd8, 0xff, 0xe0]);
  for (let i = 4; i < size; i++) bytes[i] = (seed * 31 + i * 7) % 251;
  return bytes;
}

const sha256 = async (bytes: Uint8Array) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

const upload = (p: Person, bytes: Uint8Array, headers?: Record<string, string>) =>
  p.v.request("/api/images/upload", { bytes, ...(headers ? { headers } : {}) });

async function storedFor(p: Person) {
  return (await env.IMAGES.list({ prefix: `${p.userId}/` })).objects.length;
}

describe("uploading a photo", () => {
  it("stores it under its content hash and shows it back to the household", async () => {
    const june = await premiumPerson();
    const bytes = photo(300);
    const res = await upload(june, bytes);
    expect(res.status).toBe(201);
    const stored = (await res.json()) as {
      hash: string;
      bytes: number;
      contentType: string;
      url: string;
      usage: { bytes: number; count: number; maxBytes: number; maxCount: number };
    };
    expect(stored.hash).toBe(await sha256(bytes));
    expect(stored).toMatchObject({ bytes: 300, contentType: "image/jpeg" });
    expect(stored.url).toBe(`/api/images/${stored.hash}`);
    expect(stored.usage).toMatchObject({ bytes: 300, count: 1 });
    // Beta Premium gets the decided quotas (migration 0016).
    expect(stored.usage.maxBytes).toBe(10 * 1024 ** 3);

    const shown = await june.v.request(stored.url);
    expect(shown.status).toBe(200);
    expect(shown.headers.get("content-type")).toBe("image/jpeg");
    expect(shown.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
    expect(shown.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await shown.arrayBuffer())).toEqual(bytes);

    const again = await june.v.request(stored.url, {
      headers: { "if-none-match": `"${stored.hash}"` },
    });
    expect(again.status).toBe(304);
  });

  it("counts the same photo once, however often it is sent", async () => {
    const june = await premiumPerson();
    const bytes = photo(100);
    expect((await upload(june, bytes)).status).toBe(201);
    const second = await upload(june, bytes);
    expect(second.status).toBe(200);
    expect(((await second.json()) as { usage: { count: number } }).usage.count).toBe(1);
    expect(await storedFor(june)).toBe(1);
  });

  it("refuses a free account and stores nothing", async () => {
    const free = await person();
    const res = await upload(free, photo());
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "images_not_included" });
    expect(await storedFor(free)).toBe(0);
    expect(await db().select().from(image).where(eq(image.ownerUserId, free.userId))).toEqual([]);
  });

  it("refuses someone who is signed out", async () => {
    const june = await premiumPerson();
    const res = await june.v.request("/api/auth/sign-out", { body: {} });
    expect(res.status).toBe(200);
    expect((await upload(june, photo())).status).toBe(401);
  });

  it("checks what the file is, not what it is called", async () => {
    const june = await premiumPerson();
    const text = (value: string) => new TextEncoder().encode(value);
    const notImages = [
      text("PK\x03\x04 a zip of pictures, named .jpg"),
      text("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>"),
      text("<html><script>alert(1)</script></html>"),
      text("GIF89a......"),
      new Uint8Array(),
    ];
    for (const bytes of notImages) {
      const res = await upload(june, bytes, { "content-type": "image/jpeg" });
      expect(res.status).toBe(415);
      expect(await res.json()).toEqual({ error: "unsupported_type" });
    }
    expect(await storedFor(june)).toBe(0);
  });

  it("goes by the file's own type when the label is wrong", async () => {
    const june = await premiumPerson();
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const res = await upload(june, png, { "content-type": "image/jpeg" });
    expect(((await res.json()) as { contentType: string }).contentType).toBe("image/png");
  });

  it("refuses a file over the size limit, declared or not", async () => {
    const june = await premiumPerson();
    await overrideLimit(june.v, "image_max_file_bytes", 1000);
    // Without a content-length (the stream is cut off at the limit)...
    const streamed = await upload(june, photo(1500));
    expect(streamed.status).toBe(413);
    expect(await streamed.json()).toEqual({ error: "image_too_large", maxBytes: 1000 });
    // ...and with an honest one (refused before any of it is read).
    expect((await upload(june, photo(1500), { "content-length": "1500" })).status).toBe(413);
    expect((await upload(june, photo(1000))).status).toBe(201);
    expect(await storedFor(june)).toBe(1);
  });
});

describe("who can see a photo", () => {
  it("shows it only to the household that owns it", async () => {
    const june = await premiumPerson();
    const other = await premiumPerson("Sam Park");
    const free = await person("Kim Wu");
    const bytes = photo(200);
    const { hash } = (await (await upload(june, bytes)).json()) as { hash: string };

    expect((await june.v.request(`/api/images/${hash}`)).status).toBe(200);
    for (const stranger of [other, free]) {
      const res = await stranger.v.request(`/api/images/${hash}`);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "not_found" });
    }
    // Having the same picture yourself doesn't open anyone else's copy.
    expect((await upload(other, bytes)).status).toBe(201);
    expect((await other.v.request(`/api/images/${hash}`)).status).toBe(200);
  });

  it("answers the same for a photo that doesn't exist, or isn't a hash", async () => {
    const june = await premiumPerson();
    expect((await june.v.request(`/api/images/${"0".repeat(64)}`)).status).toBe(404);
    expect((await june.v.request("/api/images/not-a-hash")).status).toBe(404);
    expect((await june.v.request("/api/images/..%2F..%2Fetc")).status).toBe(404);
  });

  it("is signed-in only", async () => {
    const res = await signUpConfirmed(`signed-out-${++counter}@example.com`);
    await res.request("/api/auth/sign-out", { body: {} });
    expect((await res.request(`/api/images/${"0".repeat(64)}`)).status).toBe(401);
  });

  it("hides a photo that was removed", async () => {
    const june = await premiumPerson();
    const { hash } = (await (await upload(june, photo(120))).json()) as { hash: string };
    await db().update(image).set({ deletedAt: new Date() }).where(eq(image.hash, hash));
    expect((await june.v.request(`/api/images/${hash}`)).status).toBe(404);
  });

  it("still shows a lapsed account its photos, but takes no new ones", async () => {
    const june = await premiumPerson();
    const { hash } = (await (await upload(june, photo(150))).json()) as { hash: string };
    await db()
      .update(premiumGrant)
      .set({ revokedAt: new Date() })
      .where(eq(premiumGrant.userId, june.userId));
    expect((await june.v.request(`/api/images/${hash}`)).status).toBe(200);
    expect((await upload(june, photo())).status).toBe(403);
  });

  it("lets a partner in a shared household see each other's photos", async () => {
    const a = await premiumPerson("Ana Ruiz");
    const b = await premiumPerson("Ben Ruiz");
    const { hash } = (await (await upload(a, photo(180))).json()) as { hash: string };
    expect((await b.v.request(`/api/images/${hash}`)).status).toBe(404);
    await share(a, b);
    expect((await b.v.request(`/api/images/${hash}`)).status).toBe(200);
  });
});

describe("the photo quota", () => {
  it("stops new photos at the byte limit and stores nothing more", async () => {
    const june = await premiumPerson();
    await overrideLimit(june.v, "image_quota_bytes", 500);
    const first = photo(300);
    expect((await upload(june, first)).status).toBe(201);
    const res = await upload(june, photo(300));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "image_quota_full", limit: "bytes" });
    expect(await storedFor(june)).toBe(1);
    // What is already there stays: sending it again is not "new".
    expect((await upload(june, first)).status).toBe(200);
  });

  it("stops new photos at the count limit", async () => {
    const june = await premiumPerson();
    await overrideLimit(june.v, "image_quota_count", 2);
    expect((await upload(june, photo())).status).toBe(201);
    expect((await upload(june, photo())).status).toBe(201);
    const res = await upload(june, photo());
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "image_quota_full", limit: "count" });
    expect(await storedFor(june)).toBe(2);
  });

  it("lets a photo sent again through when the quota is full", async () => {
    const june = await premiumPerson();
    await overrideLimit(june.v, "image_quota_count", 1);
    const bytes = photo();
    expect((await upload(june, bytes)).status).toBe(201);
    expect((await upload(june, bytes)).status).toBe(200);
  });

  it("can't be beaten by sending photos at the same moment", async () => {
    const june = await premiumPerson();
    await overrideLimit(june.v, "image_quota_count", 2);
    const results = await Promise.all(Array.from({ length: 6 }, () => upload(june, photo(80))));
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(2);
    expect(statuses.filter((s) => s === 403)).toHaveLength(4);
    expect(await storedFor(june)).toBe(2);
  });

  it("counts a shared household's photos together", async () => {
    const a = await person("Ana Ruiz");
    const b = await person("Ben Ruiz");
    await share(a, b);
    await premium(a);
    await overrideLimit(a.v, "image_quota_count", 2);
    expect((await upload(a, photo())).status).toBe(201);
    expect((await upload(b, photo())).status).toBe(201);
    expect((await upload(a, photo())).status).toBe(403);
    expect((await upload(b, photo())).status).toBe(403);
  });

  it("brings a removed photo back into the count when it is sent again", async () => {
    const june = await premiumPerson();
    await overrideLimit(june.v, "image_quota_count", 1);
    const bytes = photo(90);
    const { hash } = (await (await upload(june, bytes)).json()) as { hash: string };
    await db().update(image).set({ deletedAt: new Date() }).where(eq(image.hash, hash));
    // Removed photos don't count, so there is room again, and it comes back.
    expect((await upload(june, photo())).status).toBe(201);
    expect((await upload(june, bytes)).status).toBe(403);
  });
});

describe("upload rate limits", () => {
  it("allows a number a minute for each person, counting rejected files too", async () => {
    const june = await premiumPerson();
    await overrideLimit(june.v, "image_uploads_per_minute", 3);
    expect((await upload(june, photo())).status).toBe(201);
    expect((await upload(june, new TextEncoder().encode("not a photo"))).status).toBe(415);
    expect((await upload(june, photo())).status).toBe(201);
    const limited = await upload(june, photo());
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");
    expect(await limited.json()).toEqual({ error: "rate_limited" });
    // Another person's minute is their own.
    const sam = await premiumPerson("Sam Park");
    expect((await upload(sam, photo())).status).toBe(201);
  });

  it("allows a number a day for the whole household", async () => {
    const a = await person("Ana Ruiz");
    const b = await person("Ben Ruiz");
    await share(a, b);
    await premium(a);
    await overrideLimit(a.v, "image_uploads_per_day", 2);
    expect((await upload(a, photo())).status).toBe(201);
    expect((await upload(b, photo())).status).toBe(201);
    const limited = await upload(a, photo());
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("86400");
    expect((await upload(b, photo())).status).toBe(429);
  });

  it("starts from the decided limits", async () => {
    const june = await premiumPerson();
    const res = await june.v.request("/api/entitlements");
    expect(await res.json()).toMatchObject({
      image_uploads_per_minute: 120,
      image_uploads_per_day: 6000,
      image_quota_bytes: 10 * 1024 ** 3,
      image_quota_count: 30000,
      image_max_file_bytes: 5 * 1024 ** 2,
    });
    expect(await householdOf(june.v)).toBeTruthy();
  });
});
