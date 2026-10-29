import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { quickScale } from "./recipes";
import { useOwnAccount } from "./support";

// U9 (owner's choices 2026-10-28): timers anywhere in the app, of your own or from a recipe's
// step, with Pause; a timer's time is changed by nudging it or typing it.

async function noAccessibilityProblems(page: Page) {
  const axe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
    .analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
}

test("A timer of your own: add, pause, adjust and dismiss it", async ({
  page,
  context,
  baseURL,
}, info) => {
  await page.clock.install();
  await useOwnAccount(context, baseURL!);
  await page.goto("/");
  const phone = info.project.name === "phone";

  // The sidebar's Timers (a phone's ⏱ in the top bar) opens the Timers panel.
  await page.getByRole("button", { name: /^Timers/ }).click();
  const timers = page.getByRole("dialog", { name: "Timers" });
  await expect(timers).toContainText("No timers running.");
  await timers.getByRole("button", { name: "Add timer" }).click();
  const add = page.getByRole("dialog", { name: "Add timer" });
  await add.getByLabel("Timer name").fill("Pasta");
  await expect(add.getByRole("button", { name: "Start timer" })).toBeDisabled();
  await add.getByRole("button", { name: "10 min" }).click();
  await add.getByRole("button", { name: "One more minute" }).click();
  await expect(add.getByLabel("Minutes")).toHaveValue("11");
  await add.getByRole("button", { name: "One less minute" }).click();
  await noAccessibilityProblems(page);
  await add.getByRole("button", { name: "Start timer" }).click();
  const pasta = timers.getByRole("listitem").filter({ hasText: "Pasta" });
  await expect(pasta).toContainText("Your timer");
  await expect(pasta).toContainText(/10:00|9:5\d/);
  await noAccessibilityProblems(page);

  // Paused, it holds still. (The clock runs on while the test clicks, so times may be a second
  // or two less.)
  await page.clock.fastForward("01:00");
  await pasta.getByRole("button", { name: "Pause Pasta" }).click();
  await expect(pasta).toContainText("paused");
  await page.clock.fastForward("05:00");
  await expect(pasta).toContainText(/9:00|8:5\d/);
  await pasta.getByRole("button", { name: "Resume Pasta" }).click();

  // Adjust time: the timer keeps running (owner's choice 2026-10-29) until Save time sets the
  // new time; the numbers follow it until one is changed.
  await pasta.getByRole("button", { name: "Adjust time for Pasta" }).click();
  const adjust = page.getByRole("dialog", { name: "Adjust time" });
  await expect(adjust).toContainText("Time remaining");
  await expect(adjust.getByLabel("Minutes")).toHaveValue(/^[89]$/);
  await page.clock.fastForward("01:00");
  await expect(adjust.getByLabel("Minutes")).toHaveValue(/^[78]$/);
  await adjust.getByRole("button", { name: "One more minute" }).click();
  await adjust.getByLabel("Minutes").fill("20");
  await adjust.getByLabel("Seconds").fill("30");
  await expect(adjust).toContainText("starts again from 20:30");
  await page.clock.fastForward("00:10");
  await expect(adjust).toContainText(/Time remaining[78]:\d\d/);
  await expect(adjust.getByLabel("Minutes")).toHaveValue("20");
  await noAccessibilityProblems(page);
  await adjust.getByRole("button", { name: "Save time" }).click();
  await expect(pasta).toContainText(/20:(30|2\d)/);
  await expect(pasta).not.toContainText("paused");

  // Cancel, Escape or a tap outside lets it carry on as it was.
  await pasta.getByRole("button", { name: "Adjust time for Pasta" }).click();
  await adjust.getByLabel("Minutes").fill("2");
  await adjust.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(pasta).toContainText(/20:[0-3]\d/);
  await expect(pasta).not.toContainText("paused");
  await pasta.getByRole("button", { name: "Adjust time for Pasta" }).click();
  await adjust.getByLabel("Minutes").fill("2");
  // On a phone the panel takes the whole width: Escape (or ×) instead.
  if (phone) await adjust.getByRole("button", { name: "Cancel time adjustment" }).click();
  else await page.mouse.click(5, 5);
  if (phone) await timers.getByRole("button", { name: "Close timers" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: /^Timers/ }).click();
  await expect(pasta).toContainText(/20:[0-3]\d/);
  await expect(pasta).not.toContainText("paused");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // On a computer, timers show as cards in the corner of every page, with Pause and Stop.
  const corner = page.getByRole("region", { name: "Running timers" });
  if (!phone) {
    await expect(corner).toContainText(/20:[0-3]\dYour timerPasta/);
    await corner.getByRole("button", { name: "Pause Pasta" }).click();
    await expect(corner).toContainText("paused");
    await corner.getByRole("button", { name: "Resume Pasta" }).click();
  }

  // A timer of any length, typed.
  await page.getByRole("button", { name: /^Timers/ }).click();
  await timers.getByRole("button", { name: "Add timer" }).click();
  await add.getByLabel("Seconds").fill("45");
  await add.getByRole("button", { name: "Start timer" }).click();
  const quick = timers.getByRole("listitem").filter({ hasText: /^(Finished: )?Timer/ });
  await expect(quick).toContainText(/0:4\d/);
  await page.clock.fastForward("00:50");
  await expect(quick).toContainText("Finished: Timer");
  if (!phone) {
    // A finished one in the corner is dismissed there.
    await timers.getByRole("button", { name: "Close timers" }).click();
    await expect(corner).toContainText("Done!");
    await corner.getByRole("button", { name: "Dismiss Timer" }).click();
    await expect(corner.getByText("Done!")).toHaveCount(0);
  } else {
    await quick.getByRole("button", { name: "Dismiss Timer" }).click();
    await expect(quick).toHaveCount(0);
  }

  // Kept on this device through a reload.
  await page.reload();
  await page.getByRole("button", { name: /^Timers, 1 timer/ }).click();
  await expect(timers.getByRole("listitem").filter({ hasText: "Pasta" })).toBeVisible();
  await timers.getByRole("button", { name: "Cancel Pasta" }).click();
  await expect(timers).toContainText("No timers running.");
});

// U11 (owner's request 2026-10-29): a time in the recipe page's method, quietly marked, asks
// before it starts a timer named from its step (owner's choice 2026-10-29), with either end of a
// range; on a scaled recipe a step's words still show the original and the working.
test("A time in a recipe's method starts a timer", async ({ page, context, baseURL }) => {
  await useOwnAccount(context, baseURL!);
  await page.goto("/");
  await page.getByRole("button", { name: "Add recipe" }).click();
  await page.getByLabel("Title", { exact: true }).fill("Rice");
  await page.getByLabel("Serves").fill("4");
  await page.getByRole("textbox", { name: "Ingredients" }).fill("1 cup rice");
  await page
    .getByRole("textbox", { name: "Method" })
    .fill(
      "Add 2 cups water and simmer for 18 minutes, then rest 5 minutes.\nToast the crust for 9-11 minutes.",
    );
  await expect(page.getByText("All changes saved")).toBeVisible();
  await page.getByRole("button", { name: "Done" }).first().click();

  // Doubled: the amount changes, the times don't, and the words still open the working.
  await quickScale(page, "2×");
  const method = page.getByRole("region", { name: "Method" });
  await expect(method).toContainText(
    "Add 4 cups water and simmer for ⏱18 minutes, then rest ⏱5 minutes.",
  );
  await method.getByRole("button", { name: /^Add 4 cups/ }).click();
  await expect(method).toContainText("Original: Add 2 cups water and simmer for 18 minutes");
  await noAccessibilityProblems(page);

  // It asks first, naming the timer from the step.
  await method.getByRole("button", { name: "Start a 5 minutes timer" }).click();
  const start = page.getByRole("dialog", { name: "Start a timer for 5 minutes?" });
  await expect(start).toContainText("Step 1 · Rice");
  await expect(start).toContainText("Rest");
  await noAccessibilityProblems(page);
  await start.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // A range offers either end.
  await method.getByRole("button", { name: "Start a 9 minutes timer" }).click();
  const range = page.getByRole("dialog", { name: "Start a timer for 9 minutes?" });
  await range.getByLabel("11 minutes").check();
  await expect(page.getByRole("dialog", { name: "Start a timer for 11 minutes?" })).toBeVisible();
  await page.getByRole("button", { name: "Start timer" }).click();

  await page.getByRole("button", { name: /^Timers/ }).click();
  const timers = page.getByRole("dialog", { name: "Timers" });
  const crust = timers.getByRole("listitem").filter({ hasText: "Toast the crust" });
  await expect(crust).toContainText("Step 2 · Rice");
  await expect(crust).toContainText(/1[01]:\d\d/);
  // View step goes back to the recipe, at that step.
  await crust.getByRole("button", { name: "View step for Toast the crust" }).click();
  await expect(page).toHaveURL(/#step-2$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // The step is marked for a moment, so the eye lands on it.
  await expect(page.locator("#step-2")).toHaveAttribute("data-flash", "");
  await expect(page.locator("#step-2")).not.toHaveAttribute("data-flash", "", { timeout: 5000 });

  // A timer's notification clicked while Fennl is open elsewhere: the service worker brings the
  // window forward and says which step to show (stood in for here).
  const recipe = new URL(page.url()).pathname;
  await page.goto("/");
  await expect(page.getByRole("button", { name: /^Timers/ })).toBeVisible();
  await page.evaluate(
    (path) =>
      navigator.serviceWorker.dispatchEvent(
        new MessageEvent("message", { data: { type: "fennl:show-step", path } }),
      ),
    `${recipe}#step-1`,
  );
  await expect(page).toHaveURL(/#step-1$/);
  await expect(page.locator("#step-1")).toHaveAttribute("data-flash", "");
});
