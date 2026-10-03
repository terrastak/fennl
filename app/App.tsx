import { useEffect, type ComponentType } from "react";
import { AuthLayout } from "./auth/AuthLayout";
import { CheckEmailPage } from "./auth/CheckEmailPage";
import { useSession } from "./auth/client";
import { EmailConfirmedPage } from "./auth/EmailConfirmedPage";
import { ForgotPasswordPage } from "./auth/ForgotPasswordPage";
import { ResetPasswordPage } from "./auth/ResetPasswordPage";
import { SignInPage } from "./auth/SignInPage";
import { SignUpPage } from "./auth/SignUpPage";
import { navigate, usePath } from "./navigation";
import { AccountPage } from "./pages/AccountPage";
import { ImportPage } from "./pages/ImportPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { RecipesPage } from "./pages/RecipesPage";
import { SettingsPage } from "./pages/SettingsPage";
import { AppShell } from "./shell/AppShell";

type Route = { title: string; Page: ComponentType };

/** Pages inside the app. They need a signed-in account. */
const ROUTES: Record<string, Route> = {
  "/": { title: "Recipes", Page: RecipesPage },
  "/import": { title: "Import", Page: ImportPage },
  "/settings": { title: "Settings", Page: SettingsPage },
  "/account": { title: "Account", Page: AccountPage },
};

/** Account screens, open to everyone. */
const ACCOUNT_ROUTES: Record<string, Route> = {
  "/sign-in": { title: "Sign in", Page: SignInPage },
  "/sign-up": { title: "Create your account", Page: SignUpPage },
  "/check-email": { title: "Check your email", Page: CheckEmailPage },
  "/email-confirmed": { title: "Email confirmed", Page: EmailConfirmedPage },
  "/forgot-password": { title: "Reset your password", Page: ForgotPasswordPage },
  "/reset-password": { title: "Choose a new password", Page: ResetPasswordPage },
};

/** Screens a signed-in person has no reason to see. */
const SIGNED_OUT_ONLY = new Set(["/sign-in", "/sign-up"]);

const NOT_FOUND: Route = { title: "Page not found", Page: NotFoundPage };

function Redirect({ to }: { to: string }) {
  useEffect(() => navigate(to, { replace: true }), [to]);
  return null;
}

export function App() {
  const path = usePath().replace(/\/+$/, "") || "/";
  const { data: session, isPending } = useSession();

  const accountRoute = ACCOUNT_ROUTES[path];
  if (accountRoute) {
    if (session && SIGNED_OUT_ONLY.has(path)) return <Redirect to="/" />;
    const { title, Page } = accountRoute;
    return (
      <AuthLayout path={path} title={title}>
        <Page />
      </AuthLayout>
    );
  }

  if (isPending) {
    return (
      <p role="status" className="visually-hidden">
        Loading Fennl…
      </p>
    );
  }
  if (!session) {
    // Keep an error from an email link (for example ?error=invalid_token) so sign-in can explain it.
    const error = new URLSearchParams(window.location.search).get("error");
    return <Redirect to={error ? `/sign-in?error=${encodeURIComponent(error)}` : "/sign-in"} />;
  }

  const { title, Page } = ROUTES[path] ?? NOT_FOUND;
  return (
    <AppShell path={path} title={title}>
      <Page />
    </AppShell>
  );
}
