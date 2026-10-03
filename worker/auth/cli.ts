// Loaded only by Better Auth's schema generator (`npm run auth:generate`), which needs the
// settings but never connects to a database or sends email.
import { betterAuth } from "better-auth";
import type { Database } from "../db/client";
import { authOptions } from "./options";

export const auth = betterAuth(
  authOptions({
    origin: "http://localhost",
    secret: "schema-generation-only-not-a-real-secret",
    db: {} as Database,
    sendEmail: async () => {},
    google: { clientId: "-", clientSecret: "-" },
    apple: { clientId: "-", clientSecret: "-" },
  }),
);
