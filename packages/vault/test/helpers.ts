import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "fixture-vault");

/** Every file under a vault folder, as paths relative to it with "/" separators. ".git" is skipped. */
export function listFiles(root: string, rel = ""): string[] {
  const out: string[] = [];
  for (const name of readdirSync(join(root, rel)).sort()) {
    if (name === ".git") continue;
    const path = rel === "" ? name : `${rel}/${name}`;
    if (statSync(join(root, path)).isDirectory()) out.push(...listFiles(root, path));
    else out.push(path);
  }
  return out;
}

/** Reads a file exactly as stored, keeping its line endings. */
export function readRaw(root: string, path: string): string {
  return readFileSync(join(root, path), "utf8");
}

export function fixtureFiles(): string[] {
  return listFiles(FIXTURE);
}

export function fixture(path: string): string {
  return readRaw(FIXTURE, path);
}

/** The lines present in `before` but not in `after`, and the other way round. */
export function changedLines(
  before: string,
  after: string,
): { removed: string[]; added: string[] } {
  const a = before.split("\n");
  const b = after.split("\n");
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  return { removed: a.slice(start, endA), added: b.slice(start, endB) };
}
