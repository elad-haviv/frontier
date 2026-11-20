/**
 * Writes the link baseline for a vault checkout and prints what changed from the previous one.
 *
 *   npm run baseline -w packages/vault -- /path/to/vault
 *
 * The file is written inside the vault at .frontier/baseline/links.json. Review it, then commit it
 * to the vault yourself.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { buildLinkBaseline, diffBaselines, type LinkBaseline } from "../src/index.js";

const root = process.argv[2] ?? process.env["VAULT_PATH"];
if (!root) {
  console.error("Usage: npm run baseline -w packages/vault -- <path to vault>");
  process.exit(1);
}

function listFiles(rel = ""): string[] {
  const out: string[] = [];
  for (const name of readdirSync(join(root!, rel)).sort()) {
    if (name === ".git") continue;
    const path = rel === "" ? name : `${rel}/${name}`;
    if (statSync(join(root!, path)).isDirectory()) out.push(...listFiles(path));
    else out.push(path);
  }
  return out;
}

const commit = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const baseline = buildLinkBaseline(commit, listFiles(), (p) => readFileSync(join(root, p), "utf8"));
const target = join(root, ".frontier", "baseline", "links.json");

if (existsSync(target)) {
  const previous = JSON.parse(readFileSync(target, "utf8")) as LinkBaseline;
  const { removed, added } = diffBaselines(previous, baseline);
  console.log(`Previous baseline: commit ${previous.vaultCommit}`);
  for (const line of removed) console.log(`- ${line}`);
  for (const line of added) console.log(`+ ${line}`);
  if (removed.length + added.length === 0) console.log("No link changed.");
}

mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, JSON.stringify(baseline, null, 2) + "\n");
console.log(
  `Wrote ${target} at commit ${commit}: ${baseline.resolved.length} resolved, ` +
    `${baseline.unresolved.length} unresolved, ${baseline.ambiguous.length} ambiguous, ` +
    `${baseline.outside.length} outside.`,
);
