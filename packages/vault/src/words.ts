import { splitFrontmatter } from "./frontmatter.js";

const HEADING_LINE = /^ {0,3}#{1,6}(?:[ \t]|$).*$/gm;
const COMMENT = /<!--[\s\S]*?-->/g;
const EMBED = /!\[\[[^\]\n]*\]\]|!\[[^\]\n]*\]\([^)\n]*\)/g;
const WIKILINK = /\[\[([^[\]\n]+?)\]\]/g;
const MD_LINK = /\[([^\]\n]*)\]\([^)\n]*\)/g;
const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu;

/** The words in a piece of text, as a reader counts them: a name, a number or a word each. */
export function countWords(text: string): number {
  return text.match(WORD)?.length ?? 0;
}

/**
 * The words of an entry's own prose: the text after the frontmatter, without headings, comments
 * and embedded pictures. A link counts as the words it shows. An entry with fewer than 80 of them
 * is a stub.
 */
export function bodyWords(text: string): number {
  const body = splitFrontmatter(text)
    .body.replace(COMMENT, " ")
    .replace(HEADING_LINE, " ")
    .replace(EMBED, " ")
    .replace(WIKILINK, (_, inner: string) => {
      const pipe = /\\?\|/.exec(inner);
      const shown = pipe ? inner.slice(pipe.index + pipe[0].length) : inner.split("#")[0]!;
      return ` ${shown} `;
    })
    .replace(MD_LINK, " $1 ");
  return countWords(body);
}
