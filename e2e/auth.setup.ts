import { expect, test as setup } from "@playwright/test";
import { SIGNED_IN_STATE, setInviteOnly, signUpConfirmed, useFreshAddress } from "./support";

setup("create and sign in a test account", async ({ page, baseURL }) => {
  // Browser tests make their own accounts, so sign-up is open (see setInviteOnly).
  setInviteOnly(false);
  await useFreshAddress(page.context());
  await signUpConfirmed(page.context(), baseURL!);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Your recipes" })).toBeVisible();
  await page.context().storageState({ path: SIGNED_IN_STATE });
});
