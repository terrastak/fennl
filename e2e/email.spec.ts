import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  bounceLatestEmail,
  latestEmailId,
  linkFromLatestEmail,
  sendEmailEvent,
  uniqueEmail,
  useOwnAccount,
} from "./support";

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

  // "Change email…" opens the box (U23), its field taking focus.
  const change = section.getByRole("button", { name: "Change email…" });
  await expect(section.getByLabel("New email address")).toHaveCount(0);
  await change.click();
  await expect(change).toHaveAttribute("aria-expanded", "true");
  await expect(section.getByLabel("New email address")).toBeFocused();
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

test("the change box closes with Cancel or Escape, and focus goes back", async ({
  page,
  context,
  baseURL,
}) => {
  const email = await useOwnAccount(context, baseURL!);
  await page.goto("/settings");
  const section = page.getByRole("region", { name: "Email" });
  const change = section.getByRole("button", { name: "Change email…" });
  const field = section.getByLabel("New email address");

  await change.click();
  await field.fill("typed@example.com");
  await section.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(field).toHaveCount(0);
  await expect(change).toHaveAttribute("aria-expanded", "false");
  await expect(change).toBeFocused();

  // Opened again it starts empty; Escape closes it too.
  await page.keyboard.press("Enter");
  await expect(field).toBeFocused();
  await expect(field).toHaveValue("");
  await page.keyboard.press("Escape");
  await expect(field).toHaveCount(0);
  await expect(change).toBeFocused();

  // A problem shows in the box, which stays open.
  await change.click();
  await field.fill(email);
  await section.getByRole("button", { name: "Send verification link" }).click();
  await expect(section.getByRole("alert")).toHaveText("That's already your email.");
  await expect(field).toBeVisible();
  await expectAccessible(page);
});

test("a used link says so, and nothing changes", async ({ page, context, baseURL }) => {
  await useOwnAccount(context, baseURL!);
  await page.goto("/verify-email-change?token=" + "0".repeat(64));
  await expect(
    page.getByRole("heading", { level: 1, name: "That link didn't work" }),
  ).toBeVisible();
  await expect(page.getByText("Your account's email hasn't changed.")).toBeVisible();
});

// Phase U14: when emails to the account's address stop arriving, a notice shows on every page
// until the address changes or the person says it's right. Each test has its own account, so
// the notice never shows in other tests.

test("a bounced address shows a notice on every page, until it's said to be right", async ({
  page,
  context,
  baseURL,
}) => {
  const email = await useOwnAccount(context, baseURL!);
  // The account's sign-up link bounced after all (the newest email to it).
  await bounceLatestEmail(page.request, email);

  await page.goto("/");
  const notice = page.getByRole("alert").filter({ hasText: "aren’t reaching you" });
  await expect(notice).toContainText(
    `Emails to ${email} aren’t reaching you, so you’d miss things like password reset links.`,
  );

  await page.goto("/import");
  await expect(notice).toBeVisible();
  await expectAccessible(page);

  await notice.getByRole("link", { name: "Change your email" }).click();
  await expect(page).toHaveURL("/settings#email");
  const section = page.getByRole("region", { name: "Email" });
  await expect(section).toContainText("Emails to this address aren’t arriving.");
  await expect(section).toBeInViewport();
  // The link opens the box for a new address, ready to type in (U23).
  await expect(section.getByLabel("New email address")).toBeFocused();
  await expect(section.getByRole("button", { name: "Change email…" })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  // Scrolled to, clear of the phone's top bar: nothing covers the section's heading.
  const heading = section.getByRole("heading", { name: "Email" });
  await expect
    .poll(() =>
      heading.evaluate((h) => {
        const r = h.getBoundingClientRect();
        return r.top >= 0 && h.contains(document.elementFromPoint(r.left + 4, r.top + 4));
      }),
    )
    .toBe(true);

  await notice.getByRole("button", { name: "This address is right" }).click();
  await expect(notice).toHaveCount(0);
  // The button went with the notice; focus carries on from the page's heading.
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeFocused();
  await expect(section).not.toContainText("aren’t arriving");
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
  await expect(page.getByText("aren’t reaching you")).toHaveCount(0);
});

test("an email marked as spam says so, and emails can be started again", async ({
  page,
  context,
  baseURL,
}) => {
  const email = await useOwnAccount(context, baseURL!);
  await sendEmailEvent(page.request, "email.complained", {
    email_id: await latestEmailId(page.request, email),
    to: [email],
  });

  await page.goto("/account");
  const notice = page.getByRole("alert").filter({ hasText: "marked as spam" });
  await expect(notice).toContainText(
    "was marked as spam, so Fennl has stopped emailing you, password reset links included.",
  );
  await expect(notice).toContainText(email);
  await notice.getByRole("button", { name: "Start emails again" }).click();
  await expect(notice).toHaveCount(0);
});

test("changing to a new address takes the notice away", async ({ page, context, baseURL }) => {
  const email = await useOwnAccount(context, baseURL!);
  await bounceLatestEmail(page.request, email);
  await page.goto("/settings#email");
  const notice = page.getByRole("alert").filter({ hasText: "aren’t reaching you" });
  await expect(notice).toBeVisible();

  const newEmail = uniqueEmail("working");
  const section = page.getByRole("region", { name: "Email" });
  // Arriving at #email opens the box (U23).
  await expect(section.getByLabel("New email address")).toBeFocused();
  await section.getByLabel("New email address").fill(newEmail);
  await section.getByRole("button", { name: "Send verification link" }).click();
  await expect(section.getByRole("status")).toContainText(`We sent a link to ${newEmail}`);
  await page.goto(await linkFromLatestEmail(page.request, newEmail));
  await page.getByRole("link", { name: "Go to Settings" }).click();
  await expect(page.getByRole("region", { name: "Email" })).toContainText(newEmail);
  await expect(page.getByText("aren’t reaching you")).toHaveCount(0);
});
