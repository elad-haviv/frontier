/**
 * The three document exports: a small website, a Word document and a PDF.
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { NodeCompiler } from "@myriaddreamin/typst-ts-node-compiler";
import { basename } from "@frontier/vault";
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
import { anchorOf, type Choice, type Chosen, demote, rewrite } from "./entries.js";

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
  protocols: { ...defaultSchema.protocols, href: ["http", "https", "mailto", "unshared"] },
  clobberPrefix: "",
};

async function toHtml(markdown: string): Promise<string> {
  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
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
  zip.end();
  const parts: Buffer[] = [];
  for await (const chunk of zip.outputStream) parts.push(chunk as Buffer);
  return Buffer.concat(parts);
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
  return `${front}${note}${parts.join("\n\n")}\n`;
}

async function pandoc(args: string[], cwd: string): Promise<void> {
  try {
    await run("pandoc", args, { cwd, timeout: 120_000, maxBuffer: 64 * 1024 * 1024 });
  } catch (err) {
    const missing = (err as { code?: string }).code === "ENOENT";
    throw new ApiError(
      "not_allowed",
      missing
        ? "Pandoc is not installed on this server, so Word and PDF exports cannot be made."
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
