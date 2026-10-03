// Fails if worker/db/schema.ts has changes that no migration covers yet (someone edited the schema
// but forgot `npm run db:generate`). Drizzle generates into a scratch copy of the migrations
// folder, so the real folder is never touched.
import { spawnSync } from "node:child_process";
import { cpSync, readdirSync, rmSync } from "node:fs";

const migrations = "worker/db/migrations";
// Drizzle only accepts an output folder relative to the project.
const scratch = "node_modules/.tmp/migrations-check";

const sqlFiles = (dir) => readdirSync(dir).filter((name) => name.endsWith(".sql"));

rmSync(scratch, { recursive: true, force: true });
cpSync(migrations, scratch, { recursive: true });
try {
  const run = spawnSync(
    "npx",
    [
      "drizzle-kit",
      "generate",
      "--dialect=sqlite",
      "--schema=./worker/db/schema.ts",
      `--out=./${scratch}`,
    ],
    { encoding: "utf8" },
  );
  const output = `${run.stdout}${run.stderr}`;
  const added = sqlFiles(scratch).filter((name) => !sqlFiles(migrations).includes(name));

  if (added.length > 0) {
    console.error(
      "worker/db/schema.ts has changes with no migration. Run `npm run db:generate` and commit the result.",
    );
    process.exit(1);
  }
  // Drizzle can exit successfully after an error, so require its "nothing to do" message.
  if (run.status !== 0 || !output.includes("No schema changes")) {
    console.error(output);
    console.error(
      "Couldn't confirm the migrations match worker/db/schema.ts (see Drizzle's output above).",
    );
    process.exit(1);
  }
  console.log("Migrations match worker/db/schema.ts.");
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
