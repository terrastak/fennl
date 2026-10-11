import { writeFileSync } from "node:fs";
import { expect, test as setup } from "@playwright/test";
import {
  ADMIN_ACCOUNTS,
  ADMIN_ATTEMPTS,
  ADMIN_PROJECTS,
  ADMINS_FILE,
  SIGNED_IN_STATE,
  runLocalSql,
  setInviteOnly,
  signUpConfirmed,
  useFreshAddress,
  type AdminLabel,
} from "./support";

// Runs before every other browser test, alone.

setup("create and sign in a test account", async ({ page, baseURL }) => {
  // Browser tests make their own accounts, so sign-up is open (see setInviteOnly).
  await setInviteOnly(page.request, false);
  await useFreshAddress(page.context());
  await signUpConfirmed(page.context(), baseURL!);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Your recipes" })).toBeVisible();
  await page.context().storageState({ path: SIGNED_IN_STATE });
});

setup("create the admin accounts", async ({ browser, baseURL }) => {
  // The admin role is only ever granted by a direct database command, exactly as the runbook does
  // it. That's done here, while no other test is using the app, so the write can't catch the app
  // server mid-query (support.ts, runLocalSql).
  const admins: Record<string, string> = {};
  const jobs: Promise<void>[] = [];
  for (const project of ADMIN_PROJECTS) {
    for (const [label, name] of Object.entries(ADMIN_ACCOUNTS) as [AdminLabel, string][]) {
      for (let attempt = 0; attempt < ADMIN_ATTEMPTS; attempt++) {
        jobs.push(
          (async () => {
            const context = await browser.newContext({
              baseURL: baseURL!,
              storageState: { cookies: [], origins: [] },
            });
            await useFreshAddress(context);
            admins[`${project}:${label}:${attempt}`] = await signUpConfirmed(
              context,
              baseURL!,
              name,
            );
            await context.close();
          })(),
        );
      }
    }
  }
  await Promise.all(jobs);
  const emails = Object.values(admins)
    .map((e) => `'${e}'`)
    .join(", ");
  runLocalSql(`UPDATE user SET role = 'admin' WHERE email IN (${emails})`);
  writeFileSync(ADMINS_FILE, JSON.stringify(admins, null, 2));
});
