import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { useOwnAccount } from "./support";

// Phase B8: sending feedback from any page. The admin inbox is checked in admin.spec.ts.

test("send feedback from any page", async ({ page, context, baseURL }) => {
  const email = await useOwnAccount(context, baseURL!);
  await page.goto("/settings");
  // A computer shows it in the sidebar, a phone in the top bar.
  await page.getByRole("link", { name: /^(Send feedback|Feedback)$/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Send feedback" })).toBeVisible();
  await expect(page).toHaveURL(/\/feedback\?from=%2Fsettings$/);

  await page.getByLabel("What would you like to tell us?").fill("The settings page is lovely.");
  await page.getByRole("button", { name: "Send feedback" }).click();
  await expect(page.getByRole("status")).toContainText("Thank you!");
  await expect(page.getByRole("status")).toContainText(email);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
    .analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);

  await page.getByRole("button", { name: "Send another" }).click();
  await expect(page.getByLabel("What would you like to tell us?")).toHaveValue("");
});
