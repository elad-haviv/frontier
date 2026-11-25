/**
 * Finding a finding's passage in the text. The AI copies words from the entry as they read, so
 * links, emphasis, case, quote marks and runs of spaces are folded away on both sides, as the
 * server did when it checked the passage was there (`plainForQuotes`), and the place found is
 * mapped back to the text as it is written.
 */

/** The text as compared, and for each of its characters where it is in the text as written. */
function fold(text: string): { plain: string; at: number[] } {
  let plain = "";
  const at: number[] = [];
  let space = true;
  for (let i = 0; i < text.length;) {
    if (text.startsWith("[[", i)) {
      const end = text.indexOf("]]", i);
      const bar = end === -1 ? -1 : text.indexOf("|", i);
      // [[target|words]] reads as its words; [[target]] as its target.
      i = bar !== -1 && bar < end ? bar + 1 : i + 2;
      continue;
    }
    if (text.startsWith("]]", i)) {
      i += 2;
      continue;
    }
    const tag = /^<\/?u>/i.exec(text.slice(i, i + 4));
    if (tag) {
      i += tag[0].length;
      continue;
    }
    let ch = text[i]!;
    if ("*_`~".includes(ch)) {
      i++;
      continue;
    }
    if (/\s/.test(ch)) {
      if (!space) {
        plain += " ";
        at.push(i);
      }
      space = true;
      i++;
      continue;
    }
    ch = ch === "“" || ch === "”" ? '"' : ch === "‘" || ch === "’" ? "'" : ch;
    plain += ch.toLowerCase();
    at.push(i);
    space = false;
    i++;
  }
  return { plain, at };
}

/** Where the words are in the text, or null when they are not there (any more). */
export function findAnchor(
  text: string,
  anchor: string,
  /** Where it was last found, to pick the nearest place when the words occur more than once. */
  near = 0,
): { from: number; to: number } | null {
  const want = fold(anchor).plain.trim();
  if (want === "") return null;
  const { plain, at } = fold(text);
  let best = -1;
  for (let i = plain.indexOf(want); i !== -1; i = plain.indexOf(want, i + 1)) {
    if (best === -1 || Math.abs(at[i]! - near) < Math.abs(at[best]! - near)) best = i;
  }
  if (best === -1) return null;
  return { from: at[best]!, to: at[best + want.length - 1]! + 1 };
}
