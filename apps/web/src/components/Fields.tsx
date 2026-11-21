import type { EntryFields } from "@frontier/schema";
import { Link } from "react-router-dom";
import { entryUrl } from "../api.ts";

const WIKI = /\[\[([^[\]\n]+?)\]\]/g;

/** A date as the lore words it, with the links inside it working. */
function When({ item }: { item: EntryFields["time"][number] }) {
  const parts: React.ReactNode[] = [];
  let pos = 0;
  let n = 0;
  for (const m of item.when.matchAll(WIKI)) {
    const link = item.links[n++];
    parts.push(item.when.slice(pos, m.index));
    const inner = m[1]!;
    const bar = inner.indexOf("|");
    const label = bar === -1 ? inner.split("/").pop()! : inner.slice(bar + 1);
    parts.push(
      link?.kind === "resolved" && link.target ? (
        <Link key={m.index} to={entryUrl(link.target)} className="link-resolved">
          {label}
        </Link>
      ) : (
        <span key={m.index} className="link-unresolved" title="No entry of this name">
          {label}
        </span>
      ),
    );
    pos = m.index + m[0].length;
  }
  parts.push(item.when.slice(pos));
  return <>{parts}</>;
}

/** The entry's type and dates, shown under its title. Nothing is drawn for an entry without any. */
export function Fields({ fields }: { fields: EntryFields }) {
  const showType = fields.type !== null && (fields.typeFrom === "field" || fields.time.length > 0);
  if (!showType && fields.time.length === 0 && fields.problems.length === 0) return null;
  return (
    <dl className="fields">
      {showType && (
        <div>
          <dt>Type</dt>
          <dd>
            {fields.type}
            {!fields.typeKnown && <span className="field-mark"> not in the schema</span>}
          </dd>
        </div>
      )}
      {fields.time.map((item, i) => (
        <div key={i}>
          <dt>
            {item.what}
            {!item.known && <span className="field-mark"> ?</span>}
          </dt>
          <dd>
            <When item={item} />
          </dd>
        </div>
      ))}
      {fields.problems.map((p) => (
        <div key={p} className="field-problem">
          <dt>Cannot be read</dt>
          <dd>{p}</dd>
        </div>
      ))}
    </dl>
  );
}
