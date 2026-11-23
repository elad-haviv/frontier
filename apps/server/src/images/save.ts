import { randomBytes } from "node:crypto";
import { makeId } from "@frontier/schema";
import { basename, nextFreeName } from "@frontier/vault";
import type { Services } from "../app.js";

/** A file name as an image is kept under: no folder, and none of the signs a link cannot hold. */
export function cleanImageName(name: string): string {
  return basename(name.replace(/\\/g, "/"))
    .replace(/[\\/:*?"<>|#^[\]]/g, "")
    .trim();
}

/**
 * Keeps an image as a draft in the upload folder, to be published with the entry that uses it.
 * The name is made unique across the whole vault, ignoring letter case, so its embed needs no
 * folder.
 */
export async function saveImage(
  s: Pick<Services, "index" | "drafts" | "config" | "status">,
  wanted: string,
  content: Buffer,
): Promise<{ path: string; embed: string }> {
  const taken = [...s.index.files, ...s.drafts.list().map((d) => d.path)];
  const name = nextFreeName(wanted, taken);
  const path = `${s.config.uploadFolder}/${name}`;
  await s.drafts.saveBinary(makeId(randomBytes), path, content);
  s.status.drafts(s.drafts.count(), 0);
  return { path, embed: `![[${name}]]` };
}
