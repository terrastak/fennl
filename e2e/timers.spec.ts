import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { useOwnAccount } from "./support";

// U9 (owner's choices 2026-10-28): timers anywhere in the app, of your own or from a recipe's
// step, with Pause; a timer's time is changed by nudging it or typing it.

async function noAccessibilityProblems(page: Page) {
  const axe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
    .analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
}

test("A timer of your own: start, pause, change and dismiss it", async ({
  page,
  context,
  baseURL,
}, info) => {
  await page.clock.install();
  await useOwnAccount(context, baseURL!);
  await page.goto("/");
  const phone = info.project.name === "phone";

  // The sidebar's Timers (a phone's ⏱ in the top bar) opens the Timers window.
  await page.getByRole("button", { name: /^Timers/ }).click();
  const timers = page.getByRole("dialog", { name: "Timers" });
  await expect(timers.getByText("No timers running.")).toBeVisible();
  await timers.getByLabel("Name (optional)").fill("Pasta");
  await timers.getByRole("button", { name: "10 min timer" }).click();
  const pasta = timers.getByRole("listitem").filter({ hasText: "Pasta" });
  await expect(pasta).toContainText("Your timer");
  await expect(
    pasta.getByRole("button", { name: /^Change Pasta: (10:00|9:5\d) left/ }),
  ).toBeVisible();
  await noAccessibilityProblems(page);

  // Paused, it holds still. (The clock runs on while the test clicks, so times may be a second
  // or two less.)
  await page.clock.fastForward("01:00");
  await pasta.getByRole("button", { name: "Pause Pasta" }).click();
  await expect(pasta).toContainText("paused");
  await page.clock.fastForward("05:00");
  await expect(
    pasta.getByRole("button", { name: /^Change Pasta: (9:00|8:5\d) left, paused/ }),
  ).toBeVisible();
  await pasta.getByRole("button", { name: "Resume Pasta" }).click();

  // Changed: nudged and typed; it pauses while open, and Done starts it from the new time.
  await pasta.getByRole("button", { name: /^Change Pasta/ }).click();
  const editor = page.getByRole("dialog", { name: "Pasta" });
  await expect(editor.getByLabel("min")).toHaveValue(/^0[89]$/);
  await editor.getByRole("button", { name: "+5 min" }).click();
  await expect(editor.getByLabel("min")).toHaveValue(/^1[34]$/);
  await editor.getByLabel("min").fill("20");
  await editor.getByLabel("sec").fill("30");
  await noAccessibilityProblems(page);
  await editor.getByRole("button", { name: "Done" }).click();
  await expect(
    pasta.getByRole("button", { name: /^Change Pasta: 20:(30|2\d) left/ }),
  ).toBeVisible();
  // Cancel (or Escape) lets it carry on as it was.
  await pasta.getByRole("button", { name: /^Change Pasta/ }).click();
  await editor.getByLabel("min").fill("2");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // On a computer, running timers float in the corner of every page.
  if (!phone) {
    const floating = page.getByRole("region", { name: "Running timers" });
    await expect(floating).toContainText(/Pasta · 20:[0-3]\d/);
  }

  // A timer of any length: "Other…".
  await page.getByRole("button", { name: /^Timers/ }).click();
  await timers.getByRole("button", { name: "Other…" }).click();
  const fresh = page.getByRole("dialog", { name: "New timer" });
  await fresh.getByLabel("min").fill("0");
  await fresh.getByLabel("sec").fill("45");
  await fresh.getByRole("button", { name: "Start" }).click();
  const quick = timers.getByRole("listitem").filter({ hasText: /^Timer/ });
  await expect(quick).toContainText(/0:4\d/);
  await page.clock.fastForward("00:50");
  await expect(quick).toContainText("Done!");
  if (!phone) {
    // A finished one floating in the corner opens the list, where it's dismissed.
    await timers.getByRole("button", { name: "Close" }).click();
    await page
      .getByRole("region", { name: "Running timers" })
      .getByRole("button", { name: /Timer · Done!/ })
      .click();
    await expect(timers.getByRole("heading", { name: "Timers" })).toBeVisible();
  }
  await quick.getByRole("button", { name: "Dismiss Timer" }).click();
  await expect(quick).toHaveCount(0);
  await expect(timers.getByRole("listitem")).toHaveCount(1);

  // Kept on this device through a reload.
  await page.reload();
  await page.getByRole("button", { name: /^Timers, 1 timer/ }).click();
  await expect(timers.getByRole("listitem").filter({ hasText: "Pasta" })).toBeVisible();
});
