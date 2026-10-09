import { and, asc, eq, gt, inArray, isNull } from "drizzle-orm";
import { Zip, ZipDeflate, ZipPassThrough } from "fflate";
import { Hono } from "hono";
import {
  EXPORT_FORMAT,
  EXPORT_VERSION,
  type ExportFile,
  type ExportPerson,
  type ExportPhoto,
  type ExportRecipe,
} from "../../shared/exportFormat";
import { CATEGORY_SEPARATOR, RECIPE_FIELDS, type RecipeContent } from "../../shared/recipe";
import type { Database } from "../db/client";
import { member, user } from "../db/auth-schema";
import {
  category,
  image,
  recipe,
  recipeCategory,
  recipeMade,
  recipeOpinion,
  recipePhoto,
} from "../db/schema";
import { requireHousehold, type SignedIn } from "../household/requireHousehold";
import { imageKey } from "../images/images";
import { toRecipe } from "../sync/pull";
import { contentsPage, recipeFile, recipePage, type ContentsEntry } from "./html";

// Full-library export (phase C10): GET /api/export downloads a .zip of every recipe the
// household can see (not those in Trash), as data (fennl-recipes.json, shared/exportFormat.ts)
// and as web pages (html.ts). Always allowed, whatever the plan, even a lapsed one: recipes are
// never held hostage (CLAUDE.md, "Lapsed subscriptions").
//
// It's built and sent a batch of recipes at a time, so a big library never has to fit in memory.
//
// Photos (phase D3) come last, in a photos folder, stored as they are (they're compressed
// already). Leaving them out (?photos=0) makes a much smaller download.

/** Recipes per database read (D1 allows 100 values in one query). */
const BATCH = 90;

const encoder = new TextEncoder();

interface Household {
  people: ExportPerson[];
  ids: string[];
  /** Category paths by category ID. */
  paths: Map<string, string>;
  /** Whether photos go in the .zip. */
  withPhotos: boolean;
  /** The photos to add, file in the .zip → R2 key, gathered as recipes are read. */
  photoFiles: Map<string, string>;
}

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
};

async function household(
  db: Database,
  householdId: string,
  withPhotos: boolean,
): Promise<Household> {
  const people = await db
    .select({ userId: user.id, name: user.name })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(eq(member.organizationId, householdId))
    .all();
  const ids = people.map((p) => p.userId);
  const categories = await db
    .select({ id: category.id, parentId: category.parentId, name: category.name })
    .from(category)
    .where(and(inArray(category.ownerUserId, ids), isNull(category.deletedAt)))
    .all();
  const byId = new Map(categories.map((c) => [c.id, c]));
  const paths = new Map<string, string>();
  for (const c of categories) {
    const names: string[] = [];
    let at: (typeof categories)[number] | undefined = c;
    for (let depth = 0; at && depth < 20; depth++) {
      names.unshift(at.name);
      at = at.parentId ? byId.get(at.parentId) : undefined;
    }
    paths.set(c.id, names.join(CATEGORY_SEPARATOR));
  }
  return { people, ids, paths, withPhotos, photoFiles: new Map() };
}

/** One batch of recipes after `after` (by ID), with everything that goes with them. */
async function batch(db: Database, home: Household, after: string): Promise<ExportRecipe[]> {
  const rows = await db
    .select()
    .from(recipe)
    .where(
      and(
        inArray(recipe.ownerUserId, home.ids),
        isNull(recipe.deletedAt),
        isNull(recipe.expungedAt),
        gt(recipe.id, after),
      ),
    )
    .orderBy(asc(recipe.id))
    .limit(BATCH)
    .all();
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const [links, opinions, made, photos] = await Promise.all([
    db
      .select({ recipeId: recipeCategory.recipeId, categoryId: recipeCategory.categoryId })
      .from(recipeCategory)
      .where(and(inArray(recipeCategory.recipeId, ids), isNull(recipeCategory.deletedAt)))
      .all(),
    db
      .select()
      .from(recipeOpinion)
      .where(and(inArray(recipeOpinion.recipeId, ids), isNull(recipeOpinion.deletedAt)))
      .all(),
    db
      .select()
      .from(recipeMade)
      .where(and(inArray(recipeMade.recipeId, ids), isNull(recipeMade.deletedAt)))
      .all(),
    db
      .select({
        recipeId: recipePhoto.recipeId,
        owner: recipePhoto.ownerUserId,
        hash: recipePhoto.imageHash,
        role: recipePhoto.role,
        width: recipePhoto.width,
        height: recipePhoto.height,
        sortOrder: recipePhoto.sortOrder,
        contentType: image.contentType,
      })
      .from(recipePhoto)
      .innerJoin(
        image,
        and(
          eq(image.ownerUserId, recipePhoto.ownerUserId),
          eq(image.hash, recipePhoto.imageHash),
          isNull(image.deletedAt),
        ),
      )
      .where(and(inArray(recipePhoto.recipeId, ids), isNull(recipePhoto.deletedAt)))
      .all(),
  ]);
  const photosOf = (recipeId: string): ExportPhoto[] =>
    photos
      .filter((p) => p.recipeId === recipeId)
      .sort(
        (a, b) =>
          Number(a.role !== "photo") - Number(b.role !== "photo") || a.sortOrder - b.sortOrder,
      )
      .map((p) => {
        let file: string | null = null;
        if (home.withPhotos) {
          file = `photos/${p.hash}.${EXTENSIONS[p.contentType] ?? "img"}`;
          home.photoFiles.set(file, imageKey(p.owner, p.hash));
        }
        return {
          hash: p.hash,
          file,
          role: p.role as ExportPhoto["role"],
          width: p.width,
          height: p.height,
        };
      });
  return rows.map((row) => {
    const r = toRecipe(row);
    const content = Object.fromEntries(
      RECIPE_FIELDS.map((field) => [field, r[field]]),
    ) as unknown as RecipeContent;
    return {
      ...content,
      id: r.id,
      ownerUserId: r.ownerUserId,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      copiedFrom: r.copiedFrom,
      import: r.import,
      categories: [
        ...new Set(
          links
            .filter((l) => l.recipeId === r.id)
            .map((l) => home.paths.get(l.categoryId))
            .filter((p): p is string => Boolean(p)),
        ),
      ].sort((a, b) => a.localeCompare(b)),
      opinions: opinions
        .filter((o) => o.recipeId === r.id && (o.rating !== null || o.favorite || o.note))
        .map((o) => ({ userId: o.userId, rating: o.rating, favorite: o.favorite, note: o.note })),
      made: made
        .filter((m) => m.recipeId === r.id)
        .map((m) => ({ userId: m.userId, madeOn: m.madeOn }))
        .sort((a, b) => b.madeOn.localeCompare(a.madeOn)),
      photos: photosOf(r.id),
    };
  });
}

/** Every batch, one after another. */
async function* allRecipes(db: Database, home: Household): AsyncGenerator<ExportRecipe[]> {
  let after = "";
  for (;;) {
    const recipes = await batch(db, home, after);
    if (recipes.length === 0) return;
    yield recipes;
    after = recipes[recipes.length - 1]?.id ?? after;
  }
}

/**
 * The export, as a .zip streamed while it's made. With `photos` (the R2 bucket), the photos go
 * in too.
 */
export function exportZip(
  db: Database,
  householdId: string,
  userId: string,
  photos: R2Bucket | null = null,
): ReadableStream {
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const zip = new Zip((error, chunk, final) => {
    if (error) {
      void writer.abort(error);
      return;
    }
    void writer.write(chunk);
    if (final) void writer.close();
  });
  const file = (name: string) => {
    const f = new ZipDeflate(name, { level: 6 });
    zip.add(f);
    return (text: string, last = false) => f.push(encoder.encode(text), last);
  };

  const build = async () => {
    const home = await household(db, householdId, photos !== null);
    const exportedAt = new Date().toISOString();
    const me = home.people.find((p) => p.userId === userId) ?? { userId, name: "" };
    const head: Omit<ExportFile, "recipes"> = {
      format: EXPORT_FORMAT,
      version: EXPORT_VERSION,
      exportedAt,
      exportedBy: me,
      people: home.people,
      categories: [...new Set(home.paths.values())].sort((a, b) => a.localeCompare(b)),
    };

    // The data file first, a batch at a time (the zip writes files one after another).
    const json = file("fennl-recipes.json");
    const opening = JSON.stringify({ ...head, recipes: [] }, null, 2);
    json(opening.slice(0, opening.lastIndexOf("[") + 1) + "\n");
    let first = true;
    for await (const recipes of allRecipes(db, home)) {
      for (const r of recipes) {
        json(`${first ? "" : ",\n"}${JSON.stringify(r)}`);
        first = false;
      }
      await writer.ready;
    }
    json("\n]}\n", true);

    // Then a page per recipe, and the contents page.
    const contents: ContentsEntry[] = [];
    for await (const recipes of allRecipes(db, home)) {
      for (const r of recipes) {
        const name = recipeFile(r);
        file(name)(recipePage(r, home.people), true);
        contents.push({ title: r.title, file: name, categories: r.categories });
      }
      await writer.ready;
    }
    file("index.html")(contentsPage(contents, exportedAt), true);

    // Then the photos, read from R2 a piece at a time.
    for (const [name, key] of photos ? home.photoFiles : []) {
      const object = await photos?.get(key);
      if (!object) {
        console.error(`Export: photo ${key} isn't in storage`);
        continue;
      }
      const entry = new ZipPassThrough(name);
      zip.add(entry);
      const reader = object.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        entry.push(value);
        await writer.ready;
      }
      entry.push(new Uint8Array(), true);
    }
    zip.end();
  };
  build().catch((error: unknown) => {
    console.error("Export failed", error);
    zip.terminate();
    void writer.abort(error);
  });
  return readable;
}

type ExportEnv = { Bindings: Env; Variables: { signedIn: SignedIn } };

export const exportRoutes = new Hono<ExportEnv>();

exportRoutes.use("/api/export", requireHousehold);

exportRoutes.get("/api/export", (c) => {
  const signedIn = c.var.signedIn;
  const day = new Date().toISOString().slice(0, 10);
  const photos = c.req.query("photos") === "0" ? null : c.env.IMAGES;
  const zip = exportZip(signedIn.db, signedIn.household.householdId, signedIn.userId, photos);
  return new Response(zip, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="fennl-recipes-${day}.zip"`,
      "cache-control": "no-store",
    },
  });
});
