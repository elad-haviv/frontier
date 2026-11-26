import type { CharacterTalk } from "./api.ts";

const titleOf = (path: string) => path.split("/").pop()!.replace(/\.md$/i, "");

/** The moment a conversation was spoken from, as the page and the export say it. */
export function momentText(moment: CharacterTalk["moment"]): string {
  const words = moment.words || "a moment not named";
  return moment.year === null ? words : `${words} (${moment.year})`;
}

/** A saved conversation as Markdown, for the author to keep outside Frontier. */
export function talkMarkdown(name: string, talk: CharacterTalk): string {
  const out = [
    `# Talk with ${name}`,
    "",
    `Speaking from ${momentText(talk.moment)}. Begun ${talk.at.slice(0, 10)}.`,
  ];
  for (const l of talk.lines) {
    out.push("");
    if (l.who === "author") {
      out.push(`**You:** ${l.text}`);
      continue;
    }
    out.push(`**${name}:** ${l.text}`);
    out.push("");
    out.push(
      l.improvised
        ? "*Improvised: nothing in the entries says this.*"
        : `*From ${l.sources.map(titleOf).join(", ")}*`,
    );
  }
  return out.join("\n") + "\n";
}

/** Hands the conversation to the browser as a file. */
export function downloadTalk(name: string, talk: CharacterTalk): void {
  const url = URL.createObjectURL(
    new Blob([talkMarkdown(name, talk)], { type: "text/markdown;charset=utf-8" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = `Talk with ${name.replace(/[^\p{L}\p{N} _-]+/gu, "").trim() || "character"} ${talk.at.slice(0, 10)}.md`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
