import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { linkFromLatestEmail, uniqueEmail, useOwnAccount } from "./support";

// Phase B7a: changing your email from Settings. The address changes only when the link sent to
// the new address is opened; the old address then gets a notice.

async function expectAccessible(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
    .analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
}

test("change your email: verify the new address, and the old one is told", async ({
  page,
  context,
  baseURL,
}) => {
  const oldEmail = await useOwnAccount(context, baseURL!);
  await page.goto("/settings");
  const section = page.getByRole("region", { name: "Email" });
  await expect(section).toContainText(oldEmail);
  await expect(section).toContainText("Verified on");

  const newEmail = uniqueEmail("moved");
  await section.getByLabel("New email address").fill(newEmail);
  await section.getByRole("button", { name: "Send verification link" }).click();
  await expect(section.getByRole("status")).toContainText(`We sent a link to ${newEmail}`);
  await expect(section).toContainText(`Until then, your account keeps ${oldEmail}`);
  await expectAccessible(page);

  await page.goto(await linkFromLatestEmail(page.request, newEmail));
  await expect(
    page.getByRole("heading", { level: 1, name: "Your new email is verified" }),
  ).toBeVisible();
  await expectAccessible(page);
  await page.getByRole("link", { name: "Go to Settings" }).click();
  await expect(page.getByRole("region", { name: "Email" })).toContainText(newEmail);

  const notices = (await (
    await page.request.get(`/api/dev/outbox?to=${encodeURIComponent(oldEmail)}`)
  ).json()) as { subject: string }[];
  expect(notices[0]?.subject).toBe("Your Fennl email address was changed");
});

test("a used link says so, and nothing changes", async ({ page, context, baseURL }) => {
  await useOwnAccount(context, baseURL!);
  await page.goto("/verify-email-change?token=" + "0".repeat(64));
  await expect(
    page.getByRole("heading", { level: 1, name: "That link didn't work" }),
  ).toBeVisible();
  await expect(page.getByText("Your account's email hasn't changed.")).toBeVisible();
});
