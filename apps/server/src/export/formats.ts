/**
 * The exports for reading: a small website, Markdown files, JSON, a Word document, a PDF and slides.
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { NodeCompiler } from "@myriaddreamin/typst-ts-node-compiler";
import { basename, remarkUnderline } from "@frontier/vault";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import type { Root } from "hast";
import { visit } from "unist-util-visit";
import yazl from "yazl";
import { ApiError } from "../errors.js";
import type { GitGateway } from "../git/gateway.js";
import type { VaultIndex } from "../index/build.js";
import {
  anchorOf,
  type Choice,
  type Chosen,
  demote,
  properties,
  rewrite,
  withoutComments,
} from "./entries.js";

const run = promisify(execFile);
const UNSHARED = "unshared:";
const MARK = "†";

const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );

/** Turns `unshared:` links into marked words, and an image's `w300` title into its width. */
function finishHtml() {
  return (tree: Root) => {
    visit(
      tree as never,
      "element",
      (node: { tagName: string; properties: Record<string, unknown>; children: unknown[] }) => {
        if (node.tagName === "a" && node.properties.href === UNSHARED) {
          node.tagName = "span";
          node.properties = { className: ["unshared"], title: "Not shared in this export" };
        }
        if (node.tagName === "img" && typeof node.properties.title === "string") {
          const width = /^w(\d+)$/.exec(node.properties.title)?.[1];
          if (width) {
            node.properties.width = width;
            delete node.properties.title;
          }
        }
      },
    );
  };
}

const schema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), "u"],
  protocols: { ...defaultSchema.protocols, href: ["http", "https", "mailto", "unshared"] },
  clobberPrefix: "",
};

async function toHtml(markdown: string): Promise<string> {
  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkUnderline)
    .use(remarkRehype)
    .use(rehypeSanitize, schema)
    .use(finishHtml)
    .use(rehypeStringify)
    .process(markdown);
  return String(file);
}

const STYLE = `:root{--paper:#f7f3ea;--ink:#23201b;--soft:#5d564b;--rule:#ddd4c2;--accent:#9a3b1c}
@media (prefers-color-scheme:dark){:root{--paper:#171512;--ink:#ebe4d6;--soft:#b3aa99;--rule:#35302a;--accent:#e08a5f}}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:17px/1.6 "Iowan Old Style",Palatino,Georgia,serif}
main{max-width:42rem;margin:0 auto;padding:2rem 1.2rem 4rem}a{color:var(--accent)}
h1,h2,h3{line-height:1.25}h1{font-size:2rem;margin:.5rem 0 1rem}
nav{font:14px system-ui,sans-serif;color:var(--soft)}img{max-width:100%;height:auto}
.unshared{text-decoration:underline dotted;text-underline-offset:.2em;cursor:help}
table{border-collapse:collapse}td,th{border:1px solid var(--rule);padding:.3rem .5rem}
ul.entries{padding-left:1.2rem}h2.folder{font:600 14px system-ui,sans-serif;letter-spacing:.05em;text-transform:uppercase;color:var(--soft);margin-top:2rem}`;

const page = (title: string, body: string, home: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title><link rel="stylesheet" href="style.css"></head>
<body><main>${home ? `<nav><a href="index.html">${escapeHtml(home)}</a></nav>` : ""}
${body}</main></body></html>
`;

/** Images to copy: library path to the name used in the export. */
class Images {
  readonly byPath = new Map<string, string>();
  name(path: string): string {
    let name = this.byPath.get(path);
    if (!name) {
      const base = basename(path).replace(/[^\p{L}\p{N}._-]+/gu, "-");
      const taken = new Set(this.byPath.values());
      name = base;
      for (let n = 2; taken.has(name); n++) name = base.replace(/(\.[^.]+)?$/, `-${n}$1`);
      this.byPath.set(path, name);
    }
    return name;
  }
}

export interface ExportDeps {
  index: VaultIndex;
  git: GitGateway;
}

/** A website: an index and a page per entry, with its images, as a zip. */
export async function site(d: ExportDeps, title: string, choice: Choice): Promise<Buffer> {
  const inExport = new Map(choice.entries.map((e) => [e.path, e]));
  const images = new Images();
  const zip = new yazl.ZipFile();
  for (const entry of choice.entries) {
    const markdown = rewrite(d.index, entry.path, inExport, {
      inside: (to: Chosen, heading, label) =>
        `[${label}](${to.slug}.html${heading ? `#${anchorOf(heading)}` : ""})`,
      outside: (label) => `[${label}](${UNSHARED})`,
      image: (path, alt, width) =>
        `![${alt}](images/${images.name(path)}${width ? ` "w${width}"` : ""})`,
    });
    const html = await toHtml(`# ${entry.title}\n\n${demote(markdown, entry.title)}`);
    zip.addBuffer(Buffer.from(page(entry.title, html, title)), `${entry.slug}.html`);
  }
  // The index: the title, then the entries by folder.
  let list = "";
  let folder: string | null = null;
  for (const e of choice.entries) {
    const f = e.path.split("/").slice(0, -1).join("/");
    if (f !== folder) {
      list += `${folder === null ? "" : "</ul>"}<h2 class="folder">${escapeHtml(f || "Top")}</h2><ul class="entries">`;
      folder = f;
    }
    list += `<li><a href="${e.slug}.html">${escapeHtml(e.title)}</a></li>`;
  }
  list += "</ul>";
  zip.addBuffer(Buffer.from(page(title, `<h1>${escapeHtml(title)}</h1>${list}`, "")), "index.html");
  zip.addBuffer(Buffer.from(STYLE), "style.css");
  for (const [path, name] of images.byPath) {
    const bytes = await d.git.readFile(path);
    if (bytes) zip.addBuffer(bytes, `images/${name}`);
  }
  return zipped(zip);
}

/** A code span, or an underline tag, in order through a paragraph. */
const SPAN_OR_TAG = /(`+)[\s\S]*?\1|<u>|<\/u>/gi;

/**
 * Underline for pandoc, which reads `<u>` as raw HTML and drops it: each matched `<u>x</u>` in a
 * paragraph becomes `[x]{.underline}`, which pandoc writes as underline in Word, Typst and slides.
 * Code spans and fenced code are left as written, and so is a tag without its partner.
 */
export function underlineForPandoc(markdown: string): string {
  const lines = markdown.split("\n");
  const out: string[] = [];
  let fence: string | null = null;
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) out.push(pairTags(paragraph.join("\n")));
    paragraph = [];
  };
  for (const line of lines) {
    const mark = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence !== null || mark) {
      flush();
      if (fence === null) fence = mark!;
      else if (mark && mark[0] === fence[0] && mark.length >= fence.length) fence = null;
      out.push(line);
    } else if (line.trim() === "") {
      flush();
      out.push(line);
    } else {
      paragraph.push(line);
    }
  }
  flush();
  return out.join("\n");
}

function pairTags(text: string): string {
  const open: number[] = [];
  const pairs: [number, number][] = [];
  for (const m of text.matchAll(SPAN_OR_TAG)) {
    if (m[1] !== undefined) continue;
    if (m[0].length === 3) open.push(m.index);
    else if (open.length) pairs.push([open.pop()!, m.index]);
  }
  // From the end, so earlier places stay where they were.
  const edits = pairs
    .flatMap(([from, to]): [number, number, string][] => [
      [from, 3, "["],
      [to, 4, "]{.underline}"],
    ])
    .sort((x, y) => y[0] - x[0]);
  let result = text;
  for (const [at, length, insert] of edits) {
    result = result.slice(0, at) + insert + result.slice(at + length);
  }
  return result;
}

/** The entries joined as one Markdown document for pandoc, with images written next to it. */
async function oneDocument(
  d: ExportDeps,
  title: string,
  choice: Choice,
  dir: string,
): Promise<string> {
  const inExport = new Map(choice.entries.map((e) => [e.path, e]));
  const images = new Images();
  let outside = false;
  const parts = choice.entries.map((entry) => {
    const markdown = rewrite(d.index, entry.path, inExport, {
      inside: (to, _heading, label) => `[${label}](#e-${to.slug})`,
      outside: (label) => {
        outside = true;
        return `${label}${MARK}`;
      },
      image: (path, alt, width) =>
        // Inches, which Word and Typst both read; a pixel is a ninety-sixth of an inch.
        `![${alt}](img/${images.name(path)})${width ? `{width=${(width / 96).toFixed(2)}in}` : ""}`,
    });
    return `# ${entry.title} {#e-${entry.slug}}\n\n${demote(markdown, entry.title)}`;
  });
  await mkdir(join(dir, "img"), { recursive: true });
  for (const [path, name] of images.byPath) {
    const bytes = await d.git.readFile(path);
    if (bytes) await writeFile(join(dir, "img", name), bytes);
  }
  const note = outside
    ? `*${MARK} marks the name of an entry that is not part of this document.*\n\n`
    : "";
  const front = `---\ntitle: ${JSON.stringify(title)}\n---\n\n`;
  return `${front}${note}${underlineForPandoc(parts.join("\n\n"))}\n`;
}

async function pandoc(args: string[], cwd: string): Promise<void> {
  try {
    await run("pandoc", args, { cwd, timeout: 120_000, maxBuffer: 64 * 1024 * 1024 });
  } catch (err) {
    const missing = (err as { code?: string }).code === "ENOENT";
    throw new ApiError(
      "not_allowed",
      missing
        ? "Pandoc is not installed on this server, so Word, PDF and slide exports cannot be made."
        : "Pandoc could not make the document.",
    );
  }
}

/** One Word document of the entries, with their images. */
export async function docx(d: ExportDeps, title: string, choice: Choice): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), "frontier-docx-"));
  try {
    await writeFile(join(dir, "main.md"), await oneDocument(d, title, choice, dir));
    await pandoc(["main.md", "-f", "markdown", "-o", "out.docx", "--resource-path=."], dir);
    return await readFile(join(dir, "out.docx"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** One PDF of the entries: pandoc writes Typst, and the Typst compiler typesets it. */
export async function pdf(d: ExportDeps, title: string, choice: Choice): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), "frontier-pdf-"));
  try {
    await writeFile(join(dir, "main.md"), await oneDocument(d, title, choice, dir));
    await pandoc(
      [
        "main.md",
        "-f",
        "markdown",
        "-t",
        "typst",
        "-s",
        "--toc",
        // The Typst compiler carries this font; without one named, its list of fonts is empty.
        "-V",
        "mainfont=Libertinus Serif",
        "-V",
        "papersize=a4",
        "-o",
        "main.typ",
      ],
      dir,
    );
    const compiler = NodeCompiler.create({ workspace: dir });
    try {
      const bytes = compiler.pdf({ mainFilePath: join(dir, "main.typ") });
      return Buffer.from(bytes);
    } catch {
      throw new ApiError("not_allowed", "The PDF could not be typeset.");
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** A zip's bytes. */
async function zipped(zip: yazl.ZipFile): Promise<Buffer> {
  zip.end();
  const parts: Buffer[] = [];
  for await (const chunk of zip.outputStream) parts.push(chunk as Buffer);
  return Buffer.concat(parts);
}

const folderOf = (path: string) => path.split("/").slice(0, -1).join("/");

/** Markdown files, one per entry, linking to each other, with a README and their images. */
export async function markdown(d: ExportDeps, title: string, choice: Choice): Promise<Buffer> {
  const inExport = new Map(choice.entries.map((e) => [e.path, e]));
  const images = new Images();
  const zip = new yazl.ZipFile();
  let outside = false;
  for (const entry of choice.entries) {
    const body = rewrite(d.index, entry.path, inExport, {
      inside: (to, heading, label) =>
        `[${label}](${to.slug}.md${heading ? `#${anchorOf(heading)}` : ""})`,
      outside: (label) => {
        outside = true;
        return `${label}${MARK}`;
      },
      image: (path, alt) => `![${alt}](images/${encodeURI(images.name(path))})`,
    });
    zip.addBuffer(
      Buffer.from(`# ${entry.title}\n\n${demote(withoutComments(body), entry.title)}\n`),
      `${entry.slug}.md`,
    );
  }
  let readme = `# ${title}\n`;
  let folder: string | null = null;
  for (const e of choice.entries) {
    const f = folderOf(e.path);
    if (f !== folder) {
      readme += `\n## ${f || "Top"}\n\n`;
      folder = f;
    }
    readme += `- [${e.title.replace(/([[\]])/g, "\\$1")}](${e.slug}.md)\n`;
  }
  if (outside)
    readme += `\n*${MARK} marks the name of an entry that is not part of this export.*\n`;
  zip.addBuffer(Buffer.from(readme), "README.md");
  for (const [path, name] of images.byPath) {
    const bytes = await d.git.readFile(path);
    if (bytes) zip.addBuffer(bytes, `images/${name}`);
  }
  return zipped(zip);
}

/** One JSON file for other tools: each entry's names, properties, text and links. */
export async function json(d: ExportDeps, title: string, choice: Choice): Promise<Buffer> {
  const inExport = new Map(choice.entries.map((e) => [e.path, e]));
  const entries = choice.entries.map((entry) => {
    const links = new Set<string>();
    const unshared = new Set<string>();
    const text = rewrite(d.index, entry.path, inExport, {
      inside: (to, heading, label) => {
        links.add(to.slug);
        return `[${label}](#${to.slug}${heading ? `/${anchorOf(heading)}` : ""})`;
      },
      outside: (label) => {
        unshared.add(label.replace(/\\(.)/g, "$1"));
        return `${label}${MARK}`;
      },
      image: (path, alt) => `![${alt}](<${path}>)`,
    });
    const note = d.index.note(entry.path)!;
    return {
      id: entry.slug,
      title: entry.title,
      path: entry.path,
      folder: folderOf(entry.path),
      aliases: note.aliases,
      properties: properties(d.index, entry.path, inExport, MARK),
      text: withoutComments(text),
      links: [...links],
      unshared: [...unshared],
    };
  });
  const document = {
    title,
    exportedAt: new Date().toISOString(),
    about:
      `Entries exported from Frontier. Links between them are written [words](#id). ` +
      `${MARK} follows the name of an entry not part of this export. Images are named by their ` +
      `path in the library and not included.`,
    entries,
  };
  return Buffer.from(JSON.stringify(document, null, 2) + "\n");
}

/** Slides: a title slide per entry and a slide per section, as a PowerPoint file. */
export async function slides(d: ExportDeps, title: string, choice: Choice): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), "frontier-slides-"));
  try {
    const inExport = new Map(choice.entries.map((e) => [e.path, e]));
    const images = new Images();
    let outside = false;
    const parts = choice.entries.map((entry) => {
      const body = rewrite(d.index, entry.path, inExport, {
        inside: (_to, _heading, label) => label,
        outside: (label) => {
          outside = true;
          return `${label}${MARK}`;
        },
        image: (path, alt) => `![${alt}](img/${images.name(path)})`,
      });
      // The entry's title is a section title; its sections are slides; deeper headings stay in
      // their slide. An opening heading that repeats the title is dropped.
      const lines = demote(body, entry.title).split("\n");
      let fenced = false;
      const shaped = lines.map((line) => {
        if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
        if (fenced) return line;
        const m = /^(#{2,6})\s+(.*)$/.exec(line);
        if (!m) return line;
        return m[1]!.length <= 3 ? `## ${m[2]}` : `**${m[2]}**`;
      });
      return `# ${entry.title}\n\n${shaped.join("\n")}`;
    });
    await mkdir(join(dir, "img"), { recursive: true });
    for (const [path, name] of images.byPath) {
      const bytes = await d.git.readFile(path);
      if (bytes) await writeFile(join(dir, "img", name), bytes);
    }
    const close = outside
      ? `\n\n# About ${MARK}\n\n${MARK} marks the name of an entry that is not part of these slides.\n`
      : "";
    const text = `---\ntitle: ${JSON.stringify(title)}\n---\n\n${underlineForPandoc(parts.join("\n\n"))}${close}\n`;
    await writeFile(join(dir, "main.md"), text);
    await pandoc(
      ["main.md", "-f", "markdown", "-o", "out.pptx", "--slide-level=2", "--resource-path=."],
      dir,
    );
    return await readFile(join(dir, "out.pptx"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
