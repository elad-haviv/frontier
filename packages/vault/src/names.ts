/**
 * The rules for an entry's name as the author types it. New entry, Rename and the folder tree
 * all check names here, so a name refused in one place is refused in all.
 */

/** Signs that a file name may not hold, on some systems or in Obsidian, or that links use. */
const UNSAFE = /[\\/:*?"<>|#^[\]]/g;

export type NameCheck = { ok: true; name: string } | { ok: false; problem: string };

/**
 * Cleans a typed name and says whether it can be used: path and link signs are left out, a
 * ".md" typed by habit is dropped, and spaces at the ends go. What is left must not be empty,
 * nor start with a dot, which would hide the file.
 */
export function checkEntryName(typed: string): NameCheck {
  const name = typed.replace(UNSAFE, "").replace(/\.md$/i, "").trim();
  if (name === "") return { ok: false, problem: "Give the entry a name." };
  if (name.startsWith(".")) return { ok: false, problem: "A name cannot start with a dot." };
  return { ok: true, name };
}
