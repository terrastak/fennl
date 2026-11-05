import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  PASSWORD,
  bounceLatestEmail,
  latestEmailId,
  linkFromLatestEmail,
  sendEmailEvent,
  signUpConfirmed,
  uniqueEmail,
  useFreshAddress,
} from "./support";

// These tests start signed out, each as a different visitor.
test.use({ storageState: { cookies: [], origins: [] } });
test.beforeEach(async ({ context }) => {
  await useFreshAddress(context);
});

test("signed-out visitors are sent to sign in", async ({ page }) => {
  await page.goto("/settings");
  // Remembering where they were going, to come back after signing in.
  await expect(page).toHaveURL("/sign-in?next=%2Fsettings");
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
  await expect(page).toHaveTitle("Sign in · Fennl");
});

test("create an account, verify the email, sign out and sign back in", async ({ page }) => {
  const email = uniqueEmail("signup");
  await page.goto("/sign-in");
  await page.getByRole("link", { name: "Create an account" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Create your account" })).toBeVisible();
  await page.getByLabel("Your name").fill("Rose Lee");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Check your email" })).toBeVisible();
  await expect(page.getByText(email)).toBeVisible();
  await expect(page.getByText("check your spam or junk folder")).toBeVisible();

  await page.goto(await linkFromLatestEmail(page.request, email));
  await expect(page.getByRole("heading", { name: "Your email is verified" })).toBeVisible();
  await page.getByRole("link", { name: "Go to your recipes" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "All recipes" })).toBeVisible();

  await page.goto("/account");
  await expect(page.getByText(email)).toBeVisible();
  await expect(page.getByText("Email and password")).toBeVisible();
  await expect(page.getByText("Rose's kitchen")).toBeVisible();
  // A new account is on the Free plan, with the limits from the plan_limits table.
  await expect(page.getByRole("heading", { name: "Your plan: Free" })).toBeVisible();
  await expect(page.getByText("Up to 100")).toBeVisible();
  await expect(page.getByText("Up to 3 MB in total")).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL("/sign-in");

  await page.goto("/");
  await expect(page).toHaveURL("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "All recipes" })).toBeVisible();
});

test("a wrong password gets a clear message", async ({ page, baseURL }) => {
  const email = await signUpConfirmed(page.context(), baseURL!);
  await page.context().clearCookies();
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("not my password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "That email and password don't match. Check them and try again.",
  );
});

test("signing in before verifying sends a fresh link, and it can be sent again", async ({
  page,
}) => {
  const email = uniqueEmail("unconfirmed");
  await page.goto("/sign-up");
  await page.getByLabel("Your name").fill("Dad");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Check your email" })).toBeVisible();

  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Check your email" })).toBeVisible();
  await linkFromLatestEmail(page.request, email, 2);

  await page.getByRole("button", { name: "Resend email" }).click();
  await expect(page.getByRole("status")).toHaveText(`We sent another link to ${email}.`);
  const link = await linkFromLatestEmail(page.request, email, 3);

  await page.goto(link);
  await expect(page.getByRole("heading", { name: "Your email is verified" })).toBeVisible();
});

/** Creates an account through the sign-up page, landing on "Check your email". */
async function signUpThroughPage(page: Page, name: string, email: string) {
  await page.goto("/sign-up");
  await page.getByLabel("Your name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Check your email" })).toBeVisible();
}

// Phase U14: a sign-up link that can't be delivered. The page asks every 15 seconds; reloading
// asks at once.
test("a mistyped sign-up address is fixed in place, and the account keeps its name", async ({
  page,
}) => {
  const local = `typo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const typo = `${local}@gmial.com`;
  const fixed = `${local}@gmail.com`;
  await signUpThroughPage(page, "Rose Lee", typo);

  await bounceLatestEmail(page.request, typo);
  await page.reload();
  await expect(page.getByRole("alert")).toHaveText(
    `We couldn’t deliver the link to ${typo}. Check the address.`,
  );
  await expect(page.getByText(`Did you mean ${fixed}?`)).toBeVisible();
  // There's no point sending it to the same address again.
  await expect(page.getByRole("button", { name: "Resend email" })).toHaveCount(0);
  const form = page.getByRole("form", { name: "Correct your email address" });
  await expect(form.getByLabel("Email address")).toHaveValue(typo);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
    .analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);

  await page.getByRole("button", { name: `Use ${fixed}` }).click();
  await expect(page.getByRole("status")).toHaveText(`We sent a new link to ${fixed}.`);
  await expect(page.getByText(`We sent a link to ${fixed}.`)).toBeVisible();
  await expect(page.getByRole("button", { name: "Resend email" })).toBeVisible();

  await page.goto(await linkFromLatestEmail(page.request, fixed));
  await expect(page.getByRole("heading", { name: "Your email is verified" })).toBeVisible();
  await page.getByRole("link", { name: "Go to your recipes" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "All recipes" })).toBeVisible();
  await page.goto("/account");
  await expect(page.getByText(fixed)).toBeVisible();
  await expect(page.getByText("Rose's kitchen")).toBeVisible();
});

test("Check your email notices a bounce by itself, and keeps focus and a long address in hand", async ({
  page,
}) => {
  await page.clock.install();
  // A long address with no hyphens, so it can't wrap at one: it must still fit a phone's screen.
  const local = `christopher.johnson.family.recipes.${Date.now()}`;
  const typo = `${local}@gmial.com`;
  const fixed = `${local}@gmail.com`;
  await signUpThroughPage(page, "Chris", typo);
  await page.getByRole("button", { name: "Resend email" }).focus();

  // No reload: the page asks again every 15 seconds.
  await bounceLatestEmail(page.request, typo);
  await page.clock.fastForward(15_000);
  const alert = page.getByRole("alert");
  await expect(alert).toHaveText(`We couldn’t deliver the link to ${typo}. Check the address.`);
  // The button that had focus went with the page it was on; focus starts at what went wrong.
  await expect(alert).toBeFocused();
  const use = page.getByRole("button", { name: `Use ${fixed}` });
  await expect(use).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
  const box = (await use.boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);

  await use.click();
  const sent = page.getByRole("status");
  await expect(sent).toHaveText(`We sent a new link to ${fixed}.`);
  await expect(sent).toBeFocused();
});

test("a sign-up address with no likely fix is typed again", async ({ page }) => {
  const wrong = uniqueEmail("wrong").replace("@example.com", "@exmaple.org");
  const right = uniqueEmail("right");
  await signUpThroughPage(page, "Ann", wrong);

  await bounceLatestEmail(page.request, wrong);
  await page.reload();
  await expect(page.getByRole("alert")).toContainText(`We couldn’t deliver the link to ${wrong}`);
  await expect(page.getByText("Did you mean")).toHaveCount(0);
  const form = page.getByRole("form", { name: "Correct your email address" });
  await form.getByLabel("Email address").fill("ann@gmail");
  await form.getByRole("button", { name: "Send the link there" }).click();
  await expect(page.getByRole("alert").last()).toHaveText(
    "That doesn’t look like an email address.",
  );
  await form.getByLabel("Email address").fill(right);
  await form.getByRole("button", { name: "Send the link there" }).click();
  await expect(page.getByRole("status")).toHaveText(`We sent a new link to ${right}.`);

  await page.goto(await linkFromLatestEmail(page.request, right));
  await expect(page.getByRole("heading", { name: "Your email is verified" })).toBeVisible();
});

test("a slow sign-up link is said to be on its way", async ({ page }) => {
  const email = uniqueEmail("slow");
  await signUpThroughPage(page, "Ann", email);
  await sendEmailEvent(page.request, "email.delivery_delayed", {
    email_id: await latestEmailId(page.request, email),
    to: [email],
  });
  await page.reload();
  await expect(page.getByRole("status")).toHaveText(
    "The link is taking longer than usual to arrive. It should still come; check your spam or junk folder too.",
  );
  await expect(page.getByRole("button", { name: "Resend email" })).toBeVisible();
});

test("reset a forgotten password", async ({ page, baseURL }) => {
  const email = await signUpConfirmed(page.context(), baseURL!);
  await page.context().clearCookies();

  await page.goto("/sign-in");
  await page.getByRole("link", { name: "Forgot password?" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Reset your password" })).toBeVisible();
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByRole("status")).toContainText("a reset link is on its way");

  await page.goto(await linkFromLatestEmail(page.request, email, 2));
  await expect(page).toHaveURL(/\/reset-password\?token=/);
  const newPassword = "a brand new password";
  await page.getByLabel("New password").fill(newPassword);
  await page.getByLabel("Type it again").fill(newPassword);
  await page.getByRole("button", { name: "Save new password" }).click();
  await expect(page.getByRole("heading", { name: "Password changed" })).toBeVisible();

  await page.getByRole("link", { name: "Go to sign in" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(newPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "All recipes" })).toBeVisible();
});

test("old or broken email links explain what to do", async ({ page }) => {
  await page.goto("/email-confirmed?error=invalid_token");
  await expect(page.getByRole("heading", { name: "That link didn't work" })).toBeVisible();
  await page.goto("/reset-password");
  await expect(page.getByRole("heading", { name: "That link didn't work" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Send a new link" })).toBeVisible();
});

test("Google and Apple buttons appear only when they're set up", async ({ page }) => {
  await page.goto("/sign-in");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue with Google" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Continue with Apple" })).toHaveCount(0);
});
