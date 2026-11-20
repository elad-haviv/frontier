/**
 * Line-ending handling. Text is edited with "\n" endings only. The file's original kind is recorded
 * when it is read and restored once, when the bytes for a commit are produced.
 */

export type LineEnding = "lf" | "crlf" | "mixed";

/** Reports which kind of line ending a text uses. A text with no line break counts as "lf". */
export function detectLineEnding(text: string): LineEnding {
  let crlf = 0;
  let lf = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      if (i > 0 && text.charCodeAt(i - 1) === 13) crlf++;
      else lf++;
    }
  }
  if (crlf > 0 && lf > 0) return "mixed";
  return crlf > 0 ? "crlf" : "lf";
}

/** Converts every "\r\n" to "\n". A lone "\r" is left alone. */
export function normaliseLineEndings(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

/**
 * Restores a file's original line endings on text that was edited in normalised form.
 * A "mixed" file cannot be restored and must not be edited; asking for it is a programming error.
 */
export function restoreLineEndings(normalised: string, kind: LineEnding): string {
  if (kind === "mixed") {
    throw new Error("A file with mixed line endings is read-only and cannot be saved.");
  }
  if (kind === "lf") return normalised;
  return normalised.replace(/\r?\n/g, "\r\n");
}
