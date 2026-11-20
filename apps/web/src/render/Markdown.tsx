import type { EntryLink } from "@frontier/schema";
import { type ComponentProps, memo } from "react";
import ReactMarkdown from "react-markdown";
import { Link } from "react-router-dom";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { wikilinks } from "./wikilinks.ts";

/**
 * Everything rendered from Markdown is untrusted. Raw HTML in a note is not rendered at all, and
 * the result is sanitised: no script, no event handlers, no frames.
 */
const schema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    a: [...(defaultSchema.attributes?.["a"] ?? []), "dataKind"],
    img: [...(defaultSchema.attributes?.["img"] ?? []), "dataKind", "width"],
  },
};

type Extra = { "data-kind"?: string; node?: unknown };

function Anchor({ href, children, title, ...rest }: ComponentProps<"a"> & Extra) {
  const kind = rest["data-kind"];
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
  const full = typeof src === "string" ? src.replace(/&w=\d+$/, "") : undefined;
  return (
    <a href={full} target="_blank" rel="noopener noreferrer" className="figure">
      <img
        src={src}
        alt={alt ?? ""}
        loading="lazy"
        decoding="async"
        {...(width ? { width } : {})}
      />
    </a>
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
