import { expect, test } from "@playwright/test";
import {
  PASSWORD,
  linkFromLatestEmail,
  makeCode,
  uniqueEmail,
  useFreshAddress,
  useOwnAccount,
} from "./support";

// Invite and promo codes (phase B5). Invite-only sign-up itself is covered by the server tests;
// here sign-up is open, so the code field is optional.

const DAY = 24 * 60 * 60 * 1000;

test("signing up with a code gives Premium", async ({ page }) => {
  await page.context().clearCookies();
  await useFreshAddress(page.context());
  const code = makeCode({
    tier: "household",
    until: new Date(Date.now() + 100 * DAY),
    allowsSignUp: true,
  });
  const email = uniqueEmail("coded");

  // An invite link can carry the code.
  await page.goto(`/sign-up?code=${code}`);
  await expect(page.getByLabel("Promo code (optional)")).toHaveValue(code);
  await page.getByLabel("Your name").fill("Iris Park");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Check your email" })).toBeVisible();

  await page.goto(await linkFromLatestEmail(page.request, email));
  await expect(page.getByRole("heading", { name: "Your email is confirmed" })).toBeVisible();
  await page.goto("/account");
  await expect(page.getByRole("heading", { name: "Your plan: Premium Household" })).toBeVisible();
  await expect(page.getByText(/^Included with your code until /)).toBeVisible();
});

test("a code that doesn't exist is caught before the account is made", async ({ page }) => {
  await page.context().clearCookies();
  await useFreshAddress(page.context());
  await page.goto("/sign-up");
  await page.getByLabel("Promo code (optional)").fill("NOT-A-REAL-CODE");
  await page.getByLabel("Your name").fill("Iris Park");
  await page.getByLabel("Email").fill(uniqueEmail("nocode"));
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "We don't recognise that code. Check it and try again.",
  );
});

test("a code can be used from the Account page", async ({ page, context, baseURL }) => {
  await useOwnAccount(context, baseURL!);
  const code = makeCode({ tier: "individual", days: 30, allowsSignUp: false });
  await page.goto("/account");
  await expect(page.getByRole("heading", { name: "Your plan: Free" })).toBeVisible();

  const section = page.getByRole("region", { name: "Have a code?" });
  await section.getByLabel("Code").fill("WRONG-CODE");
  await section.getByRole("button", { name: "Use code" }).click();
  await expect(section.getByRole("alert")).toHaveText(
    "We don't recognise that code. Check it and try again.",
  );

  await section.getByLabel("Code").fill(code.toLowerCase());
  await section.getByRole("button", { name: "Use code" }).click();
  await expect(section.getByRole("status")).toHaveText("Done. You now have Premium Individual.");
  await expect(page.getByRole("heading", { name: "Your plan: Premium Individual" })).toBeVisible();

  await section.getByLabel("Code").fill(code);
  await section.getByRole("button", { name: "Use code" }).click();
  await expect(section.getByRole("alert")).toHaveText("You've already used that code.");
});

test("sign-up doesn't insist on a code before the server says one is needed", async ({ page }) => {
  await page.context().clearCookies();
  await useFreshAddress(page.context());
  // A slow answer from the server: the form must still work, and the server does the checking.
  await page.route("**/api/sign-in-methods", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 4000));
    await route.continue();
  });
  await page.goto("/sign-up");
  await page.getByLabel("Your name").fill("Rose Lee");
  await page.getByLabel("Email").fill(uniqueEmail("slow"));
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Check your email" })).toBeVisible({
    timeout: 3000,
  });
});
