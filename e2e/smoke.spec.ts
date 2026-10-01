import { expect, test } from "@playwright/test";

test("home page loads and reaches the server", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Hello, Fennl" })).toBeVisible();
  await expect(page.getByText("Server status: ok")).toBeVisible();
});

test("unknown pages still load the app", async ({ page }) => {
  await page.goto("/some/deep/link");
  await expect(page.getByRole("heading", { name: "Hello, Fennl" })).toBeVisible();
});

test("health endpoint returns JSON", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.ok()).toBe(true);
  expect(await res.json()).toEqual({ status: "ok", service: "fennl" });
});
