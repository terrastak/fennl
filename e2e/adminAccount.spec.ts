import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { bounceLatestEmail, signInAdmin, signUpConfirmed, useFreshAddress } from "./support";

// Phase U15: the console opens on Needs attention, and an account's page says what's going on,
// what happened, and offers every tool. Locally at /admin (ACCESS_DEV_BYPASS stands in for
// Cloudflare Access). An address bounces through the email service's signed webhook (U14).
test.use({ storageState: { cookies: [], origins: [] } });
test.beforeEach(async ({ context, isMobile }) => {
  test.skip(isMobile, "The admin console is checked on a computer");
  await useFreshAddress(context);
});

async function expectAccessible(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
    .analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
}

/** Someone whose address bounces, made in a browser of their own. Returns name and email. */
async function bouncingAccount(
  browser: import("@playwright/test").Browser,
  baseURL: string,
  first: string,
  address?: string,
): Promise<{ name: string; email: string }> {
  const person = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  await useFreshAddress(person);
  const name = `${first} Ortiz ${Date.now().toString(36)}`;
  const email = await signUpConfirmed(person, baseURL, name, address);
  // The newest email to them (the sign-up link) bounced for good after all.
  await bounceLatestEmail(person.request, email);
  await person.close();
  return { name, email };
}

test("Needs attention lists an address that bounces; marking it handled takes it off", async ({
  page,
  context,
  browser,
  baseURL,
}, testInfo) => {
  const { name, email } = await bouncingAccount(browser, baseURL!, "Dana");
  await signInAdmin(page, context, testInfo, "attention");

  // The console opens on Needs attention.
  const sections = page.getByRole("navigation", { name: "Admin sections" });
  await expect(sections.getByRole("button", { name: "Needs attention" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  const attention = page.getByRole("region", { name: "Needs attention" });
  const item = attention.getByRole("listitem").filter({ hasText: name });
  await expect(item).toContainText("Needs you");
  await expect(item).toContainText(`Emails to ${email} aren’t arriving`);
  await expect(page.getByRole("region", { name: "Coming up" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Emails this week" })).toContainText("Bounced");
  await expectAccessible(page);
  await item.getByRole("button", { name: `Open ${name}` }).click();

  // The account page: the name, what's going on, what happened, the facts and the tools.
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  const goingOn = page.getByRole("region", { name: "What’s going on" });
  await expect(goingOn).toContainText(/1 thing needs you/);
  const finding = goingOn.getByRole("article", { name: `Emails to ${email} aren’t arriving` });
  await expect(finding).toContainText("Needs you");
  await expect(page.getByRole("region", { name: "Account", exact: true })).toContainText(
    "bouncing",
  );
  await expect(page.getByRole("region", { name: "Everything you can do" })).toContainText(
    "Extend or give Premium…",
  );

  // The checks that found nothing are folded away.
  const fine = goingOn.getByRole("button", { name: /^Show the \d+ checks that are fine$/ });
  await fine.click();
  await expect(goingOn.getByText("No spam complaints")).toBeVisible();
  await goingOn.getByRole("button", { name: /^Hide the/ }).click();
  await expect(goingOn.getByText("No spam complaints")).toBeHidden();

  // What happened: by kind, and by period.
  const happened = page.getByRole("region", { name: "What happened" });
  const show = happened.getByRole("group", { name: "Show" });
  const period = happened.getByRole("group", { name: "Period" });
  await expect(show.getByRole("button", { name: "Everything" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(period.getByRole("button", { name: "Last 30 days" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await show.getByRole("button", { name: "Emails" }).click();
  await expect(show.getByRole("button", { name: "Emails" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const events = happened.getByRole("list", { name: "Events, newest first" });
  await expect(events.getByRole("listitem").filter({ hasText: "bounced" }).first()).toContainText(
    "Problem",
  );
  await show.getByRole("button", { name: "Plan and limits" }).click();
  await expect(events.getByRole("listitem").first()).toContainText(/Signed up/);
  await period.getByRole("button", { name: "Everything" }).click();
  await expect(period.getByRole("button", { name: "Everything" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(happened).toContainText("kept for good");
  await period.getByRole("button", { name: "Last 90 days" }).click();
  await expectAccessible(page);

  // "See the emails" shows the emails in What happened.
  await show.getByRole("button", { name: "Everything" }).click();
  await finding.getByRole("button", { name: "See the emails" }).click();
  await expect(show.getByRole("button", { name: "Emails" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  // Marked handled, with a note: it says so here, and leaves Needs attention.
  await finding.getByRole("button", { name: /^Mark handled/ }).click();
  await finding.getByLabel("Note (optional, kept in the admin log)").fill("Asked them by phone");
  await finding.getByRole("button", { name: "Mark handled", exact: true }).click();
  await expect(finding).toContainText("Handled by Attention Admin");
  await expect(finding).toContainText("Asked them by phone");
  // The keyboard carries on from where the form was.
  await expect(
    finding.getByRole("button", { name: "Put it back in Needs attention" }),
  ).toBeFocused();
  await expectAccessible(page);

  // Put back, then fixed meanwhile (as if the address was unblocked in another tab): marking it
  // says so above the findings, where the message stays once the finding has gone.
  await finding.getByRole("button", { name: "Put it back in Needs attention" }).click();
  await expect(finding.getByRole("button", { name: /^Mark handled/ })).toBeFocused();
  await finding.getByRole("button", { name: /^Mark handled/ }).click();
  const unblocked = await page.evaluate(async (address) => {
    const found = (await (
      await fetch(`/api/admin/accounts?q=${encodeURIComponent(address)}`)
    ).json()) as { id: string }[];
    const res = await fetch(`/api/admin/accounts/${found[0]?.id ?? ""}/email/unblock`, {
      method: "POST",
    });
    return res.status;
  }, email);
  expect(unblocked).toBe(200);
  await finding.getByRole("button", { name: "Mark handled", exact: true }).click();
  await expect(goingOn.getByRole("status")).toContainText(
    `“Emails to ${email} aren’t arriving” is fixed already, so there’s nothing to mark.`,
  );
  await expect(finding).toHaveCount(0);

  await page.getByRole("button", { name: "Back to Needs attention" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Admin console" })).toBeFocused();
  await expect(attention.getByRole("status")).toHaveCount(0);
  await expect(attention.getByRole("listitem").filter({ hasText: name })).toHaveCount(0);
});

test("an admin fixes a finding with its button, then extends Premium with the passkey", async ({
  page,
  context,
  browser,
  baseURL,
}, testInfo) => {
  // A long address with nowhere to break a line, to check the page at phone width.
  const { name, email } = await bouncingAccount(
    browser,
    baseURL!,
    "Rosa",
    `rosalind.featherstonehaugh.${Date.now()}${Math.random().toString(36).slice(2, 8)}@example.com`,
  );
  await signInAdmin(page, context, testInfo, "extends");

  // Find the account from Needs attention.
  await page.getByLabel("Email or name").fill(email);
  await page.getByRole("button", { name: "Find" }).click();
  await page.getByRole("list", { name: "Matching accounts" }).getByRole("button", { name }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();

  // The finding's button opens the email tool, which takes the focus.
  const goingOn = page.getByRole("region", { name: "What’s going on" });
  const finding = goingOn.getByRole("article", { name: `Emails to ${email} aren’t arriving` });
  await finding.getByRole("button", { name: "Unblock the address" }).click();
  const emailTool = page.getByRole("region", { name: "Email address" });
  await expect(emailTool.getByRole("heading", { name: "Email address" })).toBeFocused();
  await expect(emailTool).toContainText("bouncing");
  await expectAccessible(page);
  // At phone width the address wraps inside the finding and the tool: no sideways scroll.
  const size = page.viewportSize();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(emailTool.getByRole("button", { name: `Unblock ${email}` })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
  if (size) await page.setViewportSize(size);
  await emailTool.getByRole("button", { name: `Unblock ${email}` }).click();
  await expect(emailTool.getByRole("status")).toContainText("notice is cleared");
  // Fixed: the finding is gone, and the check is fine.
  await expect(finding).toHaveCount(0);
  await expect(goingOn).toContainText(/Nothing needs you/);
  await emailTool.getByRole("button", { name: "Close Email address" }).click();
  await expect(emailTool).toHaveCount(0);

  // Extend Premium: a plan, a day, a reason, and the passkey again.
  const tools = page.getByRole("region", { name: "Everything you can do" });
  await tools.getByRole("button", { name: /^Extend or give Premium…/ }).click();
  const premium = page.getByRole("region", { name: "Extend or give Premium" });
  await expect(premium.getByRole("heading", { name: "Extend or give Premium" })).toBeFocused();
  await premium.getByLabel("Household").check();
  const until = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
  const day = `${until.getFullYear()}-${String(until.getMonth() + 1).padStart(2, "0")}-${String(
    until.getDate(),
  ).padStart(2, "0")}`;
  await premium.getByLabel("Premium until").fill(day);
  const extend = premium.getByRole("button", { name: /^Extend Premium/ });
  await expect(extend).toBeDisabled();
  await premium.getByLabel("Reason (kept in the admin log)").fill("Beta tester, code ran out");
  await extend.click();
  await expect(premium.getByRole("status")).toContainText("Premium Household until");
  await expect(page.getByRole("region", { name: "Account", exact: true })).toContainText(
    "Premium Household",
  );
  await expectAccessible(page);

  // It shows in What happened, and in the admin log for the account.
  const happened = page.getByRole("region", { name: "What happened" });
  await happened
    .getByRole("group", { name: "Show" })
    .getByRole("button", { name: "Plan and limits" })
    .click();
  await expect(happened.getByRole("list", { name: "Events, newest first" })).toContainText(
    /Premium/,
  );
  await tools.getByRole("button", { name: "Admin log for this account…" }).click();
  const log = page.getByRole("region", { name: "Admin activity for this account" });
  await expect(log.getByRole("row").filter({ hasText: "Extended Premium" }).first()).toContainText(
    "Beta tester, code ran out",
  );
});
