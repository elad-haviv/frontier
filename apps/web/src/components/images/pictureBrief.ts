/** The longest starting prompt, in characters; the author can write more. */
const MOST = 700;

/**
 * Markdown as a picture model should read it: links and embeds as plain names, no marks of
 * emphasis, code or underline, no HTML, and white space made single.
 */
export function plainForPrompt(text: string): string {
  return (
    text
      // Embeds of images and other notes say nothing about the picture.
      .replace(/!\[\[[^\]]*\]\]/g, "")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      // [[Path/Name#Heading|shown]] → shown; [[Path/Name]] → Name.
      .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, "$2")
      .replace(/\[\[([^\]]*)\]\]/g, (_m, target: string) =>
        (target.split("#")[0] ?? "").split("/").pop()!.replace(/\.md$/, ""),
      )
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/<[^>]+>/g, "")
      .replace(/(\*\*|__|~~|==|`)/g, "")
      .replace(/(^|\s)[*_]([^*_\n]+)[*_](?=\s|[.,;:!?]|$)/g, "$1$2")
      .replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+(\[.\]\s+)?|\d+[.)]\s+)/gm, "")
      .replace(/\s+/g, " ")
      .trim()
  );
}

/** Cuts a prompt at a sentence or word near the limit. */
function cut(text: string): string {
  if (text.length <= MOST) return text;
  const head = text.slice(0, MOST);
  const sentence = head.lastIndexOf(". ");
  if (sentence > MOST * 0.5) return head.slice(0, sentence + 1);
  return head.slice(0, head.lastIndexOf(" ")).trimEnd() + "…";
}

/**
 * The entry's title and its first paragraph of prose: frontmatter, headings, tables, rules,
 * code and paragraphs that are only embeds are passed over.
 */
export function openingOf(text: string, title: string): string {
  const body = text.replace(/^---\n[\s\S]*?\n---\n?/, "").replace(/```[\s\S]*?```/g, "");
  const first = body
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .find(
      (b) =>
        b !== "" &&
        !/^#{1,6}\s/.test(b) &&
        !b.startsWith("|") &&
        !/^([-*_]\s*){3,}$/.test(b) &&
        plainForPrompt(b) !== "",
    );
  const name = title.trim();
  const para = first ? plainForPrompt(first) : "";
  if (!para) return name;
  return cut(
    name && !para.toLowerCase().startsWith(name.toLowerCase()) ? `${name}. ${para}` : para,
  );
}

/** What a picture starts from: the selection when there is one, else the opening. */
export function pictureBrief(input: { text: string; title: string; selection: string }): {
  selection: string;
  opening: string;
} {
  return {
    selection: cut(plainForPrompt(input.selection)),
    opening: openingOf(input.text, input.title),
  };
}
