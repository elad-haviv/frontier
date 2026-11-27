import { type EntryFields, type EntryResponse, SYSTEM_PROPS } from "@frontier/schema";
import { customProperties, isThingKind, linkOf } from "@frontier/vault";
import { ThingLink } from "./ThingCombobox.tsx";
import { useMemo } from "react";
import { Link } from "../nav.tsx";
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
  if (
    !showType &&
    fields.time.length === 0 &&
    fields.problems.length === 0 &&
    fields.proposed.length === 0
  )
    return null;
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
      {fields.proposed
        // Proposed relations show in the Relations tab (stage 33).
        .filter((p) => p.op !== "add_relation")
        .map((p) => (
          <div key={p.id} className="field-proposed">
            <dt>{p.op === "add_time" ? p.what : "Type"}</dt>
            <dd>
              {p.op === "add_time" ? p.when : p.op === "set_type" ? p.type : ""}{" "}
              <Link to="/inbox" className="field-mark">
                proposed
              </Link>
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

/**
 * The author's own properties, under the type and dates: each key with its value. Links go to
 * their entries; values only the text can show are left out.
 */
export function CustomFields({
  text,
  links,
  props = [],
}: {
  text: string;
  links: EntryResponse["links"];
  /** What the entry's type gives it (stage 35): shown first, with the type's value where the entry has none. */
  props?: EntryFields["props"];
}) {
  const list = useMemo(() => {
    const own = (customProperties(text) ?? []).filter(
      // What only Frontier reads, such as `chattable`, is not shown to readers.
      (p) => p.kind !== "other" && !SYSTEM_PROPS[p.key.toLowerCase()],
    );
    const out: { key: string; kind: string; value: unknown }[] = [];
    const used = new Set<string>();
    for (const prop of props) {
      if (SYSTEM_PROPS[prop.key.toLowerCase()]) continue;
      const mine = own.find((p) => p.key.toLowerCase() === prop.key.toLowerCase());
      const set = mine && mine.value !== null && mine.value !== "";
      if (mine) used.add(mine.key);
      if (set) out.push({ key: mine.key, kind: mine.kind, value: mine.value });
      else if (prop.value !== undefined) {
        out.push({
          key: prop.key,
          kind: prop.kind === "choice" ? "text" : prop.kind,
          value: prop.value,
        });
      }
    }
    return [...out, ...own.filter((p) => !used.has(p.key))];
  }, [text, props]);
  if (list.length === 0) return null;
  return (
    <dl className="fields custom-fields">
      {list.map((p) => (
        <div key={p.key}>
          <dt>{p.key}</dt>
          <dd>
            <PropertyShown value={p.value} kind={p.kind} links={links} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function PropertyShown({
  value,
  kind,
  links,
}: {
  value: unknown;
  kind: string;
  links: EntryResponse["links"];
}) {
  if (value === null || value === undefined || value === "") {
    return <span className="muted">—</span>;
  }
  if (kind === "checkbox") return <>{value === true ? "Yes" : "No"}</>;
  if (isThingKind(kind)) return <ThingLink value={value} />;
  if (kind === "list") return <>{(value as unknown[]).map(String).join(", ")}</>;
  if (kind === "link") {
    const name = linkOf(value)!;
    const label = name.includes("|") ? name.slice(name.indexOf("|") + 1) : name.split("/").pop();
    // The server found the link with the others in the text, frontmatter included.
    const found = links.find((l) => l.raw === value);
    return found?.kind === "resolved" && found.target ? (
      <Link to={entryUrl(found.target)} className="link-resolved">
        {label}
      </Link>
    ) : (
      <span className="link-unresolved" title="No entry of this name">
        {label}
      </span>
    );
  }
  return <>{String(value)}</>;
}
