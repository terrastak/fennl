// Writes the secrets file that CI hands to `wrangler deploy` / `wrangler versions upload`
// (--secrets-file). Values come from environment variables (GitHub secrets and variables); unset
// ones are left out, and Cloudflare keeps whatever the Worker already has for them.
//
//   node scripts/worker-secrets.mjs <out.json> NAME [NAME...] [--new-auth-secret]
//
// --new-auth-secret adds a freshly generated BETTER_AUTH_SECRET.
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";

const [out, ...args] = process.argv.slice(2);
if (!out) {
  console.error("usage: worker-secrets.mjs <out.json> NAME [NAME...] [--new-auth-secret]");
  process.exit(2);
}

const secrets = {};
for (const name of args.filter((a) => !a.startsWith("--"))) {
  const value = process.env[name]?.trim();
  if (value) secrets[name] = value;
}
if (args.includes("--new-auth-secret")) {
  secrets.BETTER_AUTH_SECRET = randomBytes(48).toString("base64url");
}

writeFileSync(out, JSON.stringify(secrets), { mode: 0o600 });
// Names only, never values.
console.log(`Secrets for this deploy: ${Object.keys(secrets).join(", ") || "(none)"}`);
