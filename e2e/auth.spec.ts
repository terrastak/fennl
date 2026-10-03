import { expect, test } from "@playwright/test";
import {
  PASSWORD,
  linkFromLatestEmail,
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
  await expect(page).toHaveURL("/sign-in");
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
  await expect(page).toHaveTitle("Sign in · Fennl");
});

test("create an account, confirm the email, sign out and sign back in", async ({ page }) => {
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
  await expect(page.getByRole("heading", { name: "Your email is confirmed" })).toBeVisible();
  await page.getByRole("link", { name: "Go to your recipes" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Your recipes" })).toBeVisible();

  await page.goto("/account");
  await expect(page.getByText(email)).toBeVisible();
  await expect(page.getByText("Email and password")).toBeVisible();
  await expect(page.getByText("Rose's kitchen")).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL("/sign-in");

  await page.goto("/");
  await expect(page).toHaveURL("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Your recipes" })).toBeVisible();
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

test("signing in before confirming sends a fresh link, and it can be sent again", async ({
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
  await expect(page.getByRole("heading", { name: "Your email is confirmed" })).toBeVisible();
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
  await expect(page.getByRole("heading", { level: 1, name: "Your recipes" })).toBeVisible();
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
