import AxeBuilder from "@axe-core/playwright";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, expect, test, type BrowserContext, type Page } from "@playwright/test";
import { premium } from "./recipes";
import { PASSWORD, signUpConfirmed, useFreshAddress } from "./support";

// Phase E5: the Chrome extension, built for this test server and loaded into Chromium, connects
// to an account once from Fennl, shows who it's connected to, and can be disconnected from
// either side.

test.beforeEach(({ isMobile }) => {
  test.skip(isMobile, "The extension is for Chrome on a computer");
});

const EXTENSION = resolve("dist-extension");

/** Chrome names an unpacked extension after its folder: SHA-256 of the path, as letters a–p. */
function unpackedId(path: string): string {
  const hex = createHash("sha256").update(path).digest("hex").slice(0, 32);
  return [...hex].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join("");
}

async function withExtension(baseURL: string): Promise<BrowserContext> {
  const context = await chromium.launchPersistentContext(
    mkdtempSync(join(tmpdir(), "fennl-extension-")),
    {
      headless: true,
      baseURL,
      ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
        ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
        : { channel: "chromium" }),
      args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`],
    },
  );
  await useFreshAddress(context);
  return context;
}

async function expectAccessible(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
    .analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
}

test.beforeAll(() => {
  execFileSync("node", ["scripts/build-extension.mjs"], {
    // The tests' build: the panel can be told which tab to import (a test can't click
    // Chrome's toolbar). See scripts/build-extension.mjs.
    env: { ...process.env, FENNL_ORIGIN: "http://localhost:4173", FENNL_EXTENSION_TEST: "1" },
    stdio: "pipe",
  });
});

test("connect the extension once, see who it's connected to, and disconnect it", async ({
  baseURL,
}) => {
  test.setTimeout(90_000);
  const context = await withExtension(baseURL!);
  try {
    const popupUrl = `chrome-extension://${unpackedId(EXTENSION)}/popup.html`;
    await signUpConfirmed(context, baseURL!, "June Lee");

    // Not connected yet: the panel offers to connect, which opens Fennl's connect page.
    const popup = await context.newPage();
    await popup.goto(popupUrl);
    await expect(popup.getByText(/Connect this extension to your Fennl account/)).toBeVisible();
    const opened = context.waitForEvent("page");
    await popup.getByRole("button", { name: "Connect to Fennl" }).click();
    const page = await opened;
    await expect(page).toHaveURL(/\/connect-extension$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Connect the Fennl extension" }),
    ).toBeVisible();
    await expectAccessible(page);

    await page.getByRole("button", { name: "Connect the extension" }).click();
    await expect(page.getByText(/^Connected\. You can close this tab/)).toBeVisible();

    // The panel knows who it's connected to, and what the plan imports.
    const panel = await context.newPage();
    await panel.goto(popupUrl);
    await expect(panel.getByText("Connected as June Lee")).toBeVisible();
    await expect(
      panel.getByText(/Free plan · Imports recipe text\. Photos come with Premium\./),
    ).toBeVisible();
    await expectAccessible(panel);

    // Connecting again replaces the old connection rather than adding one.
    await page.reload();
    await page.getByRole("button", { name: "Connect the extension" }).click();
    await expect(page.getByText(/^Connected\./)).toBeVisible();
    await page.goto("/account");
    const list = page.getByRole("list", { name: "Connected extensions" });
    await expect(list.getByRole("listitem")).toHaveCount(1);
    await expect(list).toContainText(/Extension in Chrome on \w+/);

    // Disconnected in Settings: the panel says so and offers to connect again.
    await list.getByRole("button", { name: /Disconnect/ }).click();
    await expect(page.getByText("No extension is connected.")).toBeVisible();
    await panel.reload();
    await expect(panel.getByText(/isn't connected any more/)).toBeVisible();
  } finally {
    await context.close();
  }
});

test("disconnecting from the extension, and Fennl without it", async ({ baseURL, page }) => {
  test.setTimeout(90_000);
  const context = await withExtension(baseURL!);
  try {
    await signUpConfirmed(context, baseURL!, "Sam Park");
    const connect = await context.newPage();
    await connect.goto("/connect-extension");
    await connect.getByRole("button", { name: "Connect the extension" }).click();
    await expect(connect.getByText(/^Connected\./)).toBeVisible();

    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${unpackedId(EXTENSION)}/popup.html`);
    await expect(panel.getByText("Connected as Sam Park")).toBeVisible();
    await panel.getByRole("button", { name: "Disconnect" }).click();
    await expect(panel.getByText("Disconnected.")).toBeVisible();
    await connect.goto("/account");
    await expect(connect.getByText("No extension is connected.")).toBeVisible();
  } finally {
    await context.close();
  }

  // A browser without the extension can't connect, and is told why.
  await page.goto("/connect-extension");
  await expect(page.getByText(/can.t see the extension in this browser/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect the extension" })).toBeDisabled();
});

test("signing in from the connect page comes back to it", async ({ browser, baseURL }) => {
  const made = await browser.newContext({
    storageState: { cookies: [], origins: [] },
    baseURL: baseURL!,
  });
  await useFreshAddress(made);
  const email = await signUpConfirmed(made, baseURL!);
  await made.close();

  const context = await browser.newContext({
    storageState: { cookies: [], origins: [] },
    baseURL: baseURL!,
  });
  await useFreshAddress(context);
  const page = await context.newPage();
  await page.goto("/connect-extension");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fconnect-extension$/);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/connect-extension$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Connect the Fennl extension" }),
  ).toBeVisible();
  await context.close();
});

/** A recipe site, served by the test from the test set's saved pages. */
const SITE = "https://recipes.fennl-test.example";

async function connect(context: BrowserContext) {
  const page = await context.newPage();
  await page.goto("/connect-extension");
  await page.getByRole("button", { name: "Connect the extension" }).click();
  await expect(page.getByText(/^Connected\./)).toBeVisible();
  await page.close();
}

/** The panel, as if its button were clicked on the tab showing `url`. */
async function panelFor(context: BrowserContext, url: string) {
  const panel = await context.newPage();
  await panel.goto(
    `chrome-extension://${unpackedId(EXTENSION)}/popup.html?target=${encodeURIComponent(url)}`,
  );
  return panel;
}

test("import the page you're on, and review it in Fennl", async ({ baseURL }) => {
  test.setTimeout(90_000);
  const context = await withExtension(baseURL!);
  try {
    await signUpConfirmed(context, baseURL!, "June Lee");
    await connect(context);
    await context.route(`${SITE}/**`, (route) =>
      route.fulfill({
        contentType: "text/html",
        path: "test_pages/tasteofhome-big-soft-ginger-cookies.html",
      }),
    );
    const recipe = await context.newPage();
    await recipe.goto(`${SITE}/big-soft-ginger-cookies`);

    const panel = await panelFor(context, `${SITE}/big-soft-ginger-cookies`);
    await expect(panel.getByText("Connected as June Lee")).toBeVisible();
    await expectAccessible(panel);
    const opened = context.waitForEvent("page");
    await panel.getByRole("button", { name: "Import this page" }).click();
    const review = await opened;
    await expect(review).toHaveURL(/\/import\/[0-9a-f-]{36}$/);
    await expect(
      review.getByRole("heading", { level: 1, name: "Review the import" }),
    ).toBeVisible();
    await expect(review.getByLabel("Title", { exact: true })).toHaveValue(
      "Big Soft Ginger Cookies",
    );
    await review.getByRole("button", { name: "Save recipe" }).first().click();
    await expect(
      review.getByRole("heading", { level: 1, name: "Big Soft Ginger Cookies" }),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});

test("pages are read as the browser shows them, and the panel says what went wrong", async ({
  baseURL,
}) => {
  test.setTimeout(90_000);
  const context = await withExtension(baseURL!);
  try {
    await signUpConfirmed(context, baseURL!, "Sam Park");
    await connect(context);
    const recipeData = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "Recipe",
      name: "Drawn by a Script Stew",
      recipeIngredient: ["2 carrots", "1 onion"],
      recipeInstructions: [{ "@type": "HowToStep", text: "Simmer it all." }],
    });
    await context.route(`${SITE}/**`, (route) => {
      const url = route.request().url();
      // The recipe data only exists once the page's script has run, as on many sites.
      const body = url.endsWith("/drawn")
        ? `<!DOCTYPE html><html><head><title>Stew</title></head><body><h1>Stew</h1><script>
const data = document.createElement("script");
data.type = "application/ld+json";
data.textContent = ${JSON.stringify(recipeData)};
document.head.append(data);
</script></body></html>`
        : "<!DOCTYPE html><html><head><title>A story</title></head><body><p>No recipe here.</p></body></html>";
      return route.fulfill({ contentType: "text/html", body });
    });

    const drawn = await context.newPage();
    await drawn.goto(`${SITE}/drawn`);
    const panel = await panelFor(context, `${SITE}/drawn`);
    const opened = context.waitForEvent("page");
    await panel.getByRole("button", { name: "Import this page" }).click();
    const review = await opened;
    await expect(review.getByLabel("Title", { exact: true })).toHaveValue("Drawn by a Script Stew");

    const story = await context.newPage();
    await story.goto(`${SITE}/story`);
    const storyPanel = await panelFor(context, `${SITE}/story`);
    await storyPanel.getByRole("button", { name: "Import this page" }).click();
    await expect(storyPanel.getByRole("status")).toHaveText(
      /Fennl couldn't find a recipe on this page\./,
    );
    await expectAccessible(storyPanel);
  } finally {
    await context.close();
  }
});

/**
 * A recipe whose photo is only on a made-up site, which Fennl's server can't reach: like Food
 * Network's photo server, which refuses anything that isn't a browser.
 */
async function siteRefusingServers(context: BrowserContext) {
  const recipeData = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Recipe",
    name: "Black Cocoa Crinkle Cookies",
    image: `${SITE}/photos/crinkle.png`,
    recipeIngredient: ["1 cup flour", "1/2 cup black cocoa"],
    recipeInstructions: [{ "@type": "HowToStep", text: "Mix, roll in sugar, bake." }],
  });
  await context.route(`${SITE}/**`, (route) =>
    route.request().url().endsWith(".png")
      ? route.fulfill({ path: "test_images/Image_chocchip.png" })
      : route.fulfill({
          contentType: "text/html",
          body: `<!DOCTYPE html><html><head><title>Cookies</title><script type="application/ld+json">${recipeData}</script></head><body><h1>Cookies</h1></body></html>`,
        }),
  );
  const recipe = await context.newPage();
  await recipe.goto(`${SITE}/crinkle-cookies`);
}

/** The review screen shows the page's photo, and saving keeps it on the recipe. */
async function photoReviewedAndSaved(review: Page) {
  const photos = review.getByRole("region", { name: "Photos" });
  await expect(photos.getByRole("img", { name: "Photo 1 from the page" })).toBeVisible();
  await expect
    .poll(() =>
      photos
        .getByRole("img", { name: "Photo 1 from the page" })
        .evaluate((img: HTMLImageElement) => img.naturalWidth),
    )
    .toBeGreaterThan(0);
  await review.getByRole("button", { name: "Save recipe" }).first().click();
  await expect(
    review.getByRole("heading", { level: 1, name: "Black Cocoa Crinkle Cookies" }),
  ).toBeVisible({ timeout: 60_000 });
  await expect(
    review.getByRole("img", { name: "Black Cocoa Crinkle Cookies", exact: true }),
  ).toBeVisible();
}

/** Has the tests' build, which may read any site already, ask for photos as a real install would. */
async function askForPhotos(page: Page) {
  await page.evaluate(() =>
    (
      globalThis as unknown as {
        chrome: { storage: { local: { set(items: object): Promise<void> } } };
      }
    ).chrome.storage.local.set({ testAskForPhotos: true }),
  );
}

test("Premium: the extension brings photos from sites that refuse servers", async ({ baseURL }) => {
  test.setTimeout(120_000);
  const context = await withExtension(baseURL!);
  try {
    await signUpConfirmed(context, baseURL!, "June Lee");
    await premium(context, baseURL!);
    await connect(context);
    await siteRefusingServers(context);

    const panel = await panelFor(context, `${SITE}/crinkle-cookies`);
    // The tests' build may read any site already, so the panel doesn't ask.
    await expect(panel.getByRole("button", { name: "Import this page" })).toBeVisible();
    await expect(panel.getByRole("button", { name: "Allow photos from any site" })).toHaveCount(0);
    const opened = context.waitForEvent("page");
    await panel.getByRole("button", { name: "Import this page" }).click();
    await photoReviewedAndSaved(await opened);
  } finally {
    await context.close();
  }
});

test("Premium: connecting asks once to bring photos, as its last step", async ({ baseURL }) => {
  test.setTimeout(90_000);
  const context = await withExtension(baseURL!);
  try {
    await signUpConfirmed(context, baseURL!, "June Lee");
    // The tests' build may read any site already: have it ask as a real install would.
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${unpackedId(EXTENSION)}/popup.html`);
    await askForPhotos(panel);

    // Free keeps no photos, so connecting ends on Fennl's page.
    const page = await context.newPage();
    await page.goto("/connect-extension");
    await page.getByRole("button", { name: "Connect the extension" }).click();
    await expect(page.getByText(/^Connected\. You can close this tab/)).toBeVisible();
    await panel.reload();
    await expect(panel.getByText("Connected as June Lee")).toBeVisible();
    await expect(page).toHaveURL(/\/connect-extension$/);

    // On Premium, the tab moves on to the extension's own page to ask.
    await premium(context, baseURL!);
    await page.reload();
    await page.getByRole("button", { name: "Connect the extension" }).click();
    await expect(page).toHaveURL(/^chrome-extension:\/\/[a-p]+\/setup\.html$/);
    await expect(
      page.getByRole("heading", { level: 2, name: "One more step: photos" }),
    ).toBeVisible();
    await expect(page.getByText("Connected as June Lee")).toBeVisible();
    await expectAccessible(page);

    await page.getByRole("button", { name: "Not now" }).click();
    await expect(page.getByRole("status")).toHaveText(/^Photos aren't allowed yet\./);
    // The panel still offers it.
    await panel.reload();
    await expect(panel.getByRole("button", { name: "Allow photos from any site" })).toBeVisible();

    // Chrome doesn't ask the tests' build, which has the permission already: it says yes.
    await page.reload();
    await page.getByRole("button", { name: "Allow photos from any site" }).click();
    await expect(page.getByRole("status")).toHaveText(/^All set\./);
    await expectAccessible(page);
    await page.getByRole("button", { name: "Open Fennl" }).click();
    await expect(page).toHaveURL((url) => url.origin === new URL(baseURL!).origin);
  } finally {
    await context.close();
  }
});

test("Premium without the photo permission: a site refusing Fennl's server is offered", async ({
  baseURL,
}) => {
  test.setTimeout(120_000);
  const context = await withExtension(baseURL!);
  try {
    await signUpConfirmed(context, baseURL!, "June Lee");
    await premium(context, baseURL!);
    await connect(context);
    await siteRefusingServers(context);

    const panel = await panelFor(context, `${SITE}/crinkle-cookies`);
    await askForPhotos(panel);
    await panel.reload();
    await panel.getByRole("button", { name: "Import this page" }).click();
    await expect(
      panel.getByText(/^This site only lets a browser download its photos/),
    ).toBeVisible();
    await expectAccessible(panel);

    // Chrome's question comes from a tab of the extension's, which then finishes the import.
    const opened = context.waitForEvent("page");
    await panel.getByRole("button", { name: "Allow photos from any site" }).click();
    const setup = await opened;
    await expect(setup).toHaveURL(/\/setup\.html\?for=import$/);
    await expect(
      setup.getByRole("heading", { level: 2, name: "Bring this recipe's photos" }),
    ).toBeVisible();
    await expectAccessible(setup);
    await setup.getByRole("button", { name: "Allow photos from any site" }).click();
    await expect(setup).toHaveURL(/\/import\/[\w-]+$/);
    await photoReviewedAndSaved(setup);
  } finally {
    await context.close();
  }
});
