// Writes the secrets file that CI hands to `wrangler deploy` / `wrangler versions upload`
// (--secrets-file). Values come from environment variables (GitHub secrets and variables); unset
// ones are left out, and Cloudflare keeps whatever the Worker already has for them.
//
//   node scripts/worker-secrets.mjs <out.json> NAME [NAME...] [--new-auth-secret] [--new-push-key]
//
// --new-auth-secret adds a freshly generated BETTER_AUTH_SECRET.
// --new-push-key adds a freshly generated PUSH_PRIVATE_KEY (timer alerts, U10): a P-256 key as a
// JWK. Browsers subscribe with its public half, so replacing it ends every subscription.
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";

const [out, ...args] = process.argv.slice(2);
if (!out) {
  console.error(
    "usage: worker-secrets.mjs <out.json> NAME [NAME...] [--new-auth-secret] [--new-push-key]",
  );
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
if (args.includes("--new-push-key")) {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  secrets.PUSH_PRIVATE_KEY = JSON.stringify(privateKey.export({ format: "jwk" }));
}

writeFileSync(out, JSON.stringify(secrets), { mode: 0o600 });
// Names only, never values.
console.log(`Secrets for this deploy: ${Object.keys(secrets).join(", ") || "(none)"}`);
