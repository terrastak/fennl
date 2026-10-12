import AxeBuilder from "@axe-core/playwright";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, expect, test, type BrowserContext, type Page } from "@playwright/test";
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
    env: { ...process.env, FENNL_ORIGIN: "http://localhost:4173" },
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
    await page.goto("/settings");
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
    await connect.goto("/settings");
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
