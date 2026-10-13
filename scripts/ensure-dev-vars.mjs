// Creates .dev.vars (local settings, ignored by git) from .dev.vars.example when it's missing,
// and adds settings new to the example to an existing one (leaving every setting already there).
import { appendFileSync, copyFileSync, existsSync, readFileSync } from "node:fs";

if (!existsSync(".dev.vars")) {
  copyFileSync(".dev.vars.example", ".dev.vars");
  console.log("Created .dev.vars from .dev.vars.example.");
} else {
  const names = (text) =>
    new Set([...text.matchAll(/^\s*#?\s*([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]));
  const have = names(readFileSync(".dev.vars", "utf8"));
  const added = readFileSync(".dev.vars.example", "utf8")
    .split("\n")
    .filter((line) => /^[A-Z][A-Z0-9_]*=/.test(line) && !have.has(line.split("=")[0]));
  if (added.length > 0) {
    appendFileSync(".dev.vars", `\n# Added from .dev.vars.example\n${added.join("\n")}\n`);
    console.log(`Added to .dev.vars: ${added.map((l) => l.split("=")[0]).join(", ")}`);
  }
}
