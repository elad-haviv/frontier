import type { EntryLink } from "@frontier/schema";
import { type ComponentProps, memo, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import { Link, useLocation, useNavigate } from "react-router-dom";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { editUrl } from "../api.ts";
import { useLightbox } from "../components/Lightbox.tsx";
import { currentEntryPath } from "../components/Shell.tsx";
import { wikilinks } from "./wikilinks.ts";

/**
 * Everything rendered from Markdown is untrusted. Raw HTML in a note is not rendered at all, and
 * the result is sanitised: no script, no event handlers, no frames.
 */
const schema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    a: [...(defaultSchema.attributes?.["a"] ?? []), "dataKind", "dataTarget"],
    img: [...(defaultSchema.attributes?.["img"] ?? []), "dataKind", "width"],
  },
};

type Extra = { "data-kind"?: string; "data-target"?: string; node?: unknown };

/**
 * A link to an entry that is not written yet. Tapping it offers to write it, in the folder of the
 * note that holds the link, or in the folder the link names when it has one.
 */
function MissingEntry({ target, children }: { target: string; children: ReactNode }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const here = currentEntryPath(pathname);

  function create() {
    const clean = target
      .replace(/\\/g, "/")
      .replace(/\.md$/i, "")
      .split("/")
      .map((s) => s.replace(/[\\:*?"<>|#^[\]]/g, "").trim())
      .filter(Boolean);
    const name = clean.pop();
    if (!name) return;
    // A link that names a folder is taken from the top of the vault; a bare name goes beside this note.
    const folder =
      clean.length > 0
        ? clean.join("/")
        : here.includes("/")
          ? here.slice(0, here.lastIndexOf("/"))
          : "";
    const path = `${folder ? folder + "/" : ""}${name}.md`;
    if (
      !window.confirm(
        `"${name}" is not written yet.\n\nWrite it now?\n\nIt will be made as ${path}`,
      )
    )
      return;
    navigate(`${editUrl(path)}?new=1`);
  }

  return (
    <button
      type="button"
      className="link link-unresolved link-create"
      title="Not written yet. Tap to write it."
      onClick={create}
    >
      {children}
    </button>
  );
}

function Anchor({ href, children, title, ...rest }: ComponentProps<"a"> & Extra) {
  const kind = rest["data-kind"];
  const target = rest["data-target"];
  if (kind === "unresolved" && target)
    return <MissingEntry target={target}>{children}</MissingEntry>;
  if (kind === "unresolved" || kind === "ambiguous" || kind === "outside") {
    return (
      <span className={`link link-${kind}`} title={title}>
        {children}
      </span>
    );
  }
  if (href?.startsWith("/e/")) {
    return (
      <Link to={href} className="link link-resolved">
        {children}
      </Link>
    );
  }
  if (href?.startsWith("#")) return <a href={href}>{children}</a>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="link link-external">
      {children}
    </a>
  );
}

function Picture({ src, alt, width }: ComponentProps<"img"> & Extra) {
  const open = useLightbox();
  const address = typeof src === "string" ? src : "";
  return (
    <button
      type="button"
      className="figure"
      onClick={() => open(address)}
      aria-label={`Open image${alt ? `: ${alt}` : ""}`}
    >
      <img
        src={src}
        alt={alt ?? ""}
        loading="lazy"
        decoding="async"
        {...(width ? { width } : {})}
      />
    </button>
  );
}

export const Markdown = memo(function Markdown({
  text,
  links,
}: {
  text: string;
  links: EntryLink[];
}) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, [wikilinks, { links }]]}
      rehypePlugins={[[rehypeSanitize, schema]]}
      components={{
        a: Anchor,
        img: Picture,
        table: ({ children }) => (
          <div className="table-wrap">
            <table>{children}</table>
          </div>
        ),
      }}
    >
      {text}
    </ReactMarkdown>
  );
});
