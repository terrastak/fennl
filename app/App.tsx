import type { ComponentType } from "react";
import { AccountPage } from "./pages/AccountPage";
import { ImportPage } from "./pages/ImportPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { RecipesPage } from "./pages/RecipesPage";
import { SettingsPage } from "./pages/SettingsPage";
import { usePath } from "./navigation";
import { AppShell } from "./shell/AppShell";

const ROUTES: Record<string, { title: string; Page: ComponentType }> = {
  "/": { title: "Recipes", Page: RecipesPage },
  "/import": { title: "Import", Page: ImportPage },
  "/settings": { title: "Settings", Page: SettingsPage },
  "/account": { title: "Account", Page: AccountPage },
};

const NOT_FOUND = { title: "Page not found", Page: NotFoundPage };

export function App() {
  const path = usePath();
  const { title, Page } = ROUTES[path.replace(/\/+$/, "") || "/"] ?? NOT_FOUND;
  return (
    <AppShell path={path} title={title}>
      <Page />
    </AppShell>
  );
}
