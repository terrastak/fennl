import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { emptyRecipeContent } from "../shared/recipe";
import { directionsFromText, ingredientsFromText } from "../shared/recipeLines";
import { adjust, editorStatus, premium, recipeCard, syncStatus } from "./recipes";
import { signUpConfirmed, useFreshAddress, useOwnAccount } from "./support";

// Phase F6: printing. Chrome makes real PDFs here, which are read back to check nothing is cut
// off, no app buttons are printed, and the QR code opens the recipe only for its household.

const TACOS = "Black Bean Tacos with Lime Crema";

interface PdfPage {
  width: number;
  height: number;
  text: string;
  /** Pieces of text that run off the paper. */
  outside: number;
}

async function readPdf(bytes: Buffer): Promise<PdfPage[]> {
  const doc = await getDocument({ data: new Uint8Array(bytes), verbosity: 0 }).promise;
  const pages: PdfPage[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = page.view;
    const items = (await page.getTextContent()).items.flatMap((item) =>
      "str" in item
        ? [{ str: item.str, transform: item.transform as number[], width: item.width }]
        : [],
    );
    pages.push({
      width: x1 - x0,
      height: y1 - y0,
      text: items
        .map((item) => item.str)
        .join(" ")
        .replace(/\s+/gu, " "),
      outside: items.filter((item) => {
        const [, , , , x = 0, y = 0] = item.transform;
        return x < -1 || y < -1 || x + item.width > x1 - x0 + 1 || y > y1 - y0 + 1;
      }).length,
    });
  }
  return pages;
}

/** Records the print window opening, instead of opening it. */
async function catchPrint(page: Page) {
  await page.evaluate(() => {
    (window as unknown as { printed: number }).printed = 0;
    window.print = () => {
      (window as unknown as { printed: number }).printed++;
    };
  });
}

const printed = (page: Page) =>
  page.evaluate(() => (window as unknown as { printed: number }).printed);

async function noAccessibilityProblems(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
    .analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
}

/** A sauce linked from the tacos' ingredients (phase F3), through the editor. */
async function linkLimeCrema(page: Page) {
  const ingredientsBox = page.getByRole("textbox", { name: "Ingredients" });
  await page.getByRole("button", { name: "Add recipe" }).click();
  await page.getByLabel("Title", { exact: true }).fill("Lime Crema");
  await ingredientsBox.fill("½ cup sour cream\nZest and juice of 1 lime");
  await page.getByRole("textbox", { name: "Method" }).fill("Stir together.");
  await expect(editorStatus(page)).toHaveText("All changes saved");
  await page.getByRole("button", { name: "Done" }).first().click();
  await page.getByRole("link", { name: "All recipes" }).click();
  await page.getByRole("link", { name: /Black Bean Tacos/ }).click();
  await page.getByRole("link", { name: "Edit recipe" }).click();
  await ingredientsBox.fill(`${await ingredientsBox.inputValue()}\n½ cup lime crema`);
  await page.getByRole("button", { name: "Link a recipe" }).click();
  await page
    .getByRole("list", { name: "Recipes to link" })
    .getByRole("button", { name: "Lime Crema" })
    .click();
  await expect(editorStatus(page)).toHaveText("All changes saved");
  await page.getByRole("button", { name: "Done" }).first().click();
}

test("Print a recipe in two taps, with its linked recipe, and save it as a PDF", async ({
  page,
  context,
  baseURL,
  browser,
}) => {
  await useOwnAccount(context, baseURL!);
  await page.goto("/");
  await page.getByRole("button", { name: /sample recipes to try/ }).click();
  await expect(recipeCard(page, TACOS)).toBeVisible();
  await linkLimeCrema(page);
  await adjust(page, (panel) => panel.getByRole("button", { name: "2×" }).click());
  await expect(syncStatus(page)).toHaveText("Saved to cloud");

  // Tap one: Print on the recipe. Tap two: Print, already focused, with the last choices used.
  await page.getByRole("link", { name: "Print", exact: true }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: `Print: ${TACOS} and 1 linked recipe` }),
  ).toBeVisible();
  const print = page.getByRole("button", { name: "Print", exact: true });
  await expect(print).toBeFocused();
  await catchPrint(page);
  await print.click();
  await expect.poll(() => printed(page)).toBe(1);
  await expect(page).toHaveTitle(TACOS);

  // The recipe as printed: doubled, said so, changed amounts in bold; the sauce follows it.
  const tacos = page.getByRole("article", { name: TACOS });
  await expect(tacos).toContainText("Doubled from the original. Changed amounts are in bold.");
  await expect(tacos.locator("strong").first()).toBeVisible();
  await expect(tacos).toContainText("1 cup lime crema (recipe follows)");
  await expect(tacos).toContainText("4 cans (15 oz each) black beans");
  const crema = page.getByRole("article", { name: "Lime Crema", exact: true });
  await expect(crema).toContainText(`Used in ${TACOS}`);
  // The QR code opens the recipe's own page.
  const recipeUrl = await tacos.locator("figure[data-address]").getAttribute("data-address");
  expect(recipeUrl).toMatch(/\/recipes\/[0-9a-f-]{36}$/);
  await noAccessibilityProblems(page);

  // As a PDF: letter paper, each recipe on its own page, nothing off the edge, no app buttons.
  const pdf = await readPdf(await page.pdf({ format: "Letter", preferCSSPageSize: true }));
  expect(pdf.length).toBeGreaterThanOrEqual(2);
  for (const p of pdf) {
    expect(Math.round(p.width)).toBe(612);
    expect(p.outside).toBe(0);
    expect(p.text).not.toMatch(/Change what’s printed|Back to the recipe|Saved to cloud/);
  }
  const all = pdf.map((p) => p.text).join(" ");
  expect(all).toContain(TACOS);
  expect(all).toContain("Scan to open in Fennl");
  expect(pdf.at(-1)?.text).toContain("Stir together.");
  expect(pdf[0]?.text).not.toContain("Stir together.");

  // A recipe card: its own small paper, everything still on it.
  await page.getByText("Change what’s printed").click();
  await page.getByLabel("Recipe card, 4×6").check();
  await expect(page.getByText("Your choices are kept for next time")).toBeVisible();
  const cards = await readPdf(await page.pdf({ preferCSSPageSize: true }));
  for (const card of cards) {
    expect([Math.round(card.width), Math.round(card.height)]).toEqual([432, 288]);
    expect(card.outside).toBe(0);
  }
  expect(cards.map((c) => c.text).join(" ")).toContain("Stir together.");

  // The choices are kept with the account, not just this device.
  await page.evaluate(() => localStorage.removeItem("fennl:print"));
  await page.reload();
  await page.getByText("Change what’s printed").click();
  await expect(page.getByLabel("Recipe card, 4×6")).toBeChecked();
  await page.getByLabel("Standard").check();
  await page.getByLabel("Linked recipes, each on its own page").uncheck();
  await expect(page.getByRole("article", { name: "Lime Crema", exact: true })).toHaveCount(0);
  await expect(page.getByRole("article", { name: TACOS })).toContainText(
    "1 cup lime crema (see Lime Crema)",
  );
  await page.getByLabel("Linked recipes, each on its own page").check();

  // Printing from the browser's own menu on the recipe page prints the same clean recipe.
  await page.getByRole("link", { name: "Back to the recipe" }).click();
  await expect(page.getByRole("heading", { level: 1, name: TACOS })).toBeVisible();
  await expect(page.locator("[data-print-copy]")).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
  await page.emulateMedia({ media: "print" });
  await expect(page.locator("[data-print-copy]")).toBeVisible();
  await expect(page.getByRole("link", { name: "Edit recipe" })).toBeHidden();
  await expect(page.getByRole("navigation").first()).toBeHidden();
  await page.emulateMedia({ media: "screen" });
  await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
  await expect(page.locator("[data-print-copy]")).toHaveCount(0);

  // The QR code grants nothing by itself: someone outside the household doesn't see the recipe,
  // and someone signed out is asked to sign in.
  const outsider = await browser.newContext({
    baseURL: baseURL!,
    storageState: { cookies: [], origins: [] },
  });
  await useFreshAddress(outsider);
  const theirs = await outsider.newPage();
  await theirs.goto(recipeUrl!);
  await expect(theirs).toHaveURL(/\/sign-in/);
  await signUpConfirmed(outsider, baseURL!);
  await theirs.goto(recipeUrl!);
  await expect(theirs.getByRole("heading", { name: "This recipe isn’t here" })).toBeVisible();
  await expect(theirs.getByText("Lime Crema")).toHaveCount(0);
  await outsider.close();
});

test("Print what the list shows, or the recipes ticked, as a booklet", async ({
  page,
  context,
  baseURL,
}) => {
  await useOwnAccount(context, baseURL!);
  await page.goto("/");
  await page.getByRole("button", { name: /sample recipes to try/ }).click();
  await expect(recipeCard(page, TACOS)).toBeVisible();
  await expect(syncStatus(page)).toHaveText("Saved to cloud");

  // Narrowed by a search: Print these.
  await page.getByRole("searchbox", { name: "Search recipes" }).fill("lemon");
  await page.getByRole("button", { name: "Print these" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Print: 2 recipes" })).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(2);
  // A contents page only when asked for.
  await expect(page.getByRole("navigation", { name: "Contents" })).toHaveCount(0);
  await page.getByText("Change what’s printed").click();
  await page.getByLabel("Contents page").check();
  await expect(page.getByRole("navigation", { name: "Contents" })).toContainText(
    "Lemon Olive Oil Cake",
  );
  await page.getByLabel("Contents page").uncheck();
  await noAccessibilityProblems(page);
  await page.getByRole("link", { name: "Back to recipes" }).click();
  await expect(page.getByRole("searchbox", { name: "Search recipes" })).toHaveValue("lemon");

  // Ticked one by one in Select.
  await page.getByRole("button", { name: "Show all recipes" }).click();
  await page.getByRole("button", { name: "Select", exact: true }).click();
  await page.getByRole("checkbox", { name: TACOS }).check();
  await page.getByRole("checkbox", { name: "Green Chile Stew" }).check();
  await page.getByRole("button", { name: "Print these recipes" }).click();
  await expect(page.getByRole("article")).toHaveCount(2);
  await expect(page.getByRole("article").first()).toHaveAccessibleName(/Black Bean Tacos|Green/);
});

test("A booklet of 200 recipes is ready quickly", async ({ page, context, baseURL }, info) => {
  test.skip(info.project.name !== "desktop", "Timed once, on the desktop.");
  await useOwnAccount(context, baseURL!);
  await premium(context, baseURL!);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Your recipes" })).toBeVisible();

  // 200 recipes of a usual length, sent the way another device would.
  const deviceId = await page.evaluate(() => localStorage.getItem("fennl:device-id"));
  const ingredients = Array.from({ length: 12 }, (_, i) => `${i + 1} cups ingredient ${i}`);
  const steps = Array.from({ length: 8 }, (_, i) => `Step ${i + 1}: stir it for 5 minutes.`);
  for (let batch = 0; batch < 2; batch++) {
    const changes = Array.from({ length: 100 }, (_, i) => ({
      kind: "recipe",
      id: crypto.randomUUID(),
      create: { createdAt: new Date().toISOString(), import: null },
      fields: {
        ...emptyRecipeContent(),
        title: `Booklet recipe ${String(batch * 100 + i + 1).padStart(3, "0")}`,
        ingredients: ingredientsFromText(ingredients.join("\n")),
        directions: directionsFromText(steps.join("\n")),
      },
      changedAt: Date.now(),
    }));
    const res = await context.request.post("/api/sync/push", {
      headers: { origin: baseURL! },
      data: { deviceId, schemaVersion: 1, sentAt: Date.now(), changes },
    });
    expect(res.ok(), await res.text()).toBe(true);
  }
  await page.reload();
  await page.getByRole("searchbox", { name: "Search recipes" }).fill("booklet");
  await expect(page.getByText(/Showing 200 of 200/)).toBeVisible();

  const started = Date.now();
  await page.getByRole("button", { name: "Print these" }).click();
  await expect(page.getByRole("article")).toHaveCount(200);
  const ready = Date.now() - started;
  console.log(`A 200-recipe booklet was ready to print in ${ready} ms.`);
  expect(ready).toBeLessThan(5000);
  await expect(page.getByRole("button", { name: "Print", exact: true })).toBeEnabled();
});
