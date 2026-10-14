import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { premium, syncStatus } from "./recipes";
import { useOwnAccount } from "./support";

// Phase E7: a recipe the AI read, on the review screen. "Read again" has a stronger model read it
// once more, keeping what the person already changed; after that, if parts are still uncertain,
// Fennl says it has done what it can. The import screens that send photos come in E9 and E10;
// until then the local test server makes the import, read by its stand-in AI.

async function aiImport(page: Page, baseURL: string, unsure: boolean): Promise<string> {
  const res = await page.request.post("/api/dev/test-ai-import", {
    headers: { origin: baseURL },
    data: { unsure },
  });
  expect(res.ok()).toBe(true);
  const { jobIds } = (await res.json()) as { jobIds: string[] };
  return jobIds[0]!;
}

async function expectAccessible(page: Page) {
  const results = await new AxeBuilder({ page })
    .exclude("iframe")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
    .analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
}

test("Read again: once, keeping the person's changes, then Fennl says it has done its best", async ({
  page,
  context,
  baseURL,
}) => {
  test.setTimeout(90_000);
  await useOwnAccount(context, baseURL!);
  await premium(context, baseURL!);
  const id = await aiImport(page, baseURL!, true);

  await page.goto(`/import/${id}`);
  await expect(syncStatus(page)).toHaveText("Saved to cloud");
  await expect(page.getByRole("heading", { level: 1, name: "Review the import" })).toBeVisible();
  const offer = page.getByRole("region", { name: "Not quite right?" });
  await expect(offer).toContainText("It counts as one of this month’s AI imports.");
  await expect(page.getByText("The amount of flour is smudged")).toBeVisible();
  await expectAccessible(page);

  // The person fixes the title first; reading again keeps it.
  const title = page.getByLabel("Title", { exact: true });
  await title.fill("Grandma's Sugar Butter Balls");
  await offer.getByRole("button", { name: "Read again more carefully" }).click();

  const done = page.getByRole("region", { name: "Fennl has read this as carefully as it can" });
  await expect(done).toBeVisible();
  await expect(done).toContainText("correct them by hand");
  await expect(page.getByRole("button", { name: "Read again more carefully" })).toHaveCount(0);
  await expect(title).toHaveValue("Grandma's Sugar Butter Balls");
  await expect(page.getByRole("textbox", { name: "Ingredients" })).toHaveValue(/2 1\/4 cup flour/);
  await expectAccessible(page);

  // Still once only after a reload.
  await page.reload();
  await expect(done).toBeVisible();
  await expect(page.getByRole("button", { name: "Read again more carefully" })).toHaveCount(0);
});

test("a clear reading needs no notice; Read again stays on offer", async ({
  page,
  context,
  baseURL,
}) => {
  await useOwnAccount(context, baseURL!);
  await premium(context, baseURL!);
  const id = await aiImport(page, baseURL!, false);
  await page.goto(`/import/${id}`);
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue("Sugar Butter Balls");
  await expect(page.getByRole("button", { name: "Read again more carefully" })).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Fennl has read this as carefully as it can" }),
  ).toHaveCount(0);

  // The Account page counts it against the month's AI imports.
  await page.goto("/account");
  const usage = page.getByRole("region", { name: "Usage and limits" });
  await expect(usage.getByRole("meter", { name: "AI imports this month" })).toHaveAttribute(
    "aria-valuetext",
    "1 of 300 AI imports this month",
  );
  await expect(usage).toContainText("They start again on");
  await expect(usage).toContainText(/\d+ of \d+ devices? signed in/);
  await expectAccessible(page);
});
