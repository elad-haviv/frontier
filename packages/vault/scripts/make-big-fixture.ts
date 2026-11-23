/**
 * Copies the fixture vault's notes until there are 500, for timing tests.
 * Output goes to test/.big-fixture, which is not committed, or to a folder of that name inside
 * it, so tests running side by side each have their own.
 *
 *   npm run big-fixture -w packages/vault [-- name]
 */
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = join(here, "..", "test", "fixture-vault");
const target = join(here, "..", "test", ".big-fixture", ...process.argv.slice(2, 3));
const WANTED = 500;

rmSync(target, { recursive: true, force: true });
cpSync(source, target, { recursive: true });

const template = readFileSync(join(source, "01 Places", "Harbor", "Old Quay.md"), "utf8");
mkdirSync(join(target, "04 Generated"), { recursive: true });
for (let i = 1; i <= WANTED; i++) {
  const body =
    template.replace("# Old Quay", `# Generated ${i}`) +
    `\nNext: [[Generated ${(i % WANTED) + 1}]].\n`;
  writeFileSync(join(target, "04 Generated", `Generated ${i}.md`), body);
}
console.log(`Wrote ${WANTED} generated notes to ${target}`);
