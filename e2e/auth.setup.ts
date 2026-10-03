import { expect, test as setup } from "@playwright/test";
import { SIGNED_IN_STATE, signUpConfirmed, useFreshAddress } from "./support";

setup("create and sign in a test account", async ({ page, baseURL }) => {
  await useFreshAddress(page.context());
  await signUpConfirmed(page.context(), baseURL!);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Your recipes" })).toBeVisible();
  await page.context().storageState({ path: SIGNED_IN_STATE });
});
