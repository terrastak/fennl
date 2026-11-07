import { expect, test } from "@playwright/test";

test("home page shows the recipes page", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "All recipes" })).toBeVisible();
  await expect(page).toHaveTitle("Recipes · Fennl");
});

test("settings shows the server and database are reachable", async ({ page }) => {
  await page.goto("/settings");
  // "Server status: ok, database connected" on a phone; on a laptop (U23) a row named Server
  // status with "OK, database connected" on its right.
  const about = page.getByRole("region", { name: "About" });
  await expect(about).toContainText("Server status");
  await expect(about.locator("output")).toHaveText(/^ok, database connected$/i);
});

test("unknown addresses show a friendly not-found page inside the app", async ({ page }) => {
  await page.goto("/some/deep/link");
  await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
  await page.getByRole("link", { name: "Go to your recipes" }).click();
  await expect(page).toHaveURL("/");
});

test("health endpoint returns JSON, including the database", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.ok()).toBe(true);
  expect(await res.json()).toEqual({ status: "ok", service: "fennl", database: "ok" });
});

test("the app can be installed", async ({ page, request }) => {
  await page.goto("/");
  const href = await page.locator('link[rel="manifest"]').getAttribute("href");
  expect(href).toBe("/manifest.webmanifest");
  const manifest = await (await request.get(href as string)).json();
  expect(manifest).toMatchObject({ name: "Fennl", display: "standalone", start_url: "/" });
  for (const icon of manifest.icons as { src: string }[]) {
    expect((await request.get(icon.src)).ok(), icon.src).toBe(true);
  }
});
