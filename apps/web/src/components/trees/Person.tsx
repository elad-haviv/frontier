import type { ReactNode } from "react";
import type { AddWhere } from "../../trees/data.ts";
import {
  downs,
  edgeOf,
  type Graph,
  kindNamed,
  partners,
  title,
  ups,
  equals,
  warningsOf,
} from "../../trees/model.ts";

const initials = (n: string) =>
  n
    .replace(/^(the|of)\s+/i, "")
    .split(/[\s-]+/)
    .filter((w) => /^\p{Lu}/u.test(w))
    .slice(0, 2)
    .map((w) => w[0])
    .join("") || n.slice(0, 1).toUpperCase();

export interface Section {
  title: string;
  where?: AddWhere;
  worked?: boolean;
  items: { key: string; tag?: string }[];
}

/** The people round one person, by kind: parents, partners, children, siblings, rivals. */
export function sectionsOf(g: Graph, kindName: string, id: string): Section[] {
  const kind = kindNamed(g, kindName);
  const k = kind?.name ?? kindName;
  const out: Section[] = [];
  const tag = (a: string, b: string, kk = k) => edgeOf(g, kk, a, b)?.how ?? undefined;
  out.push({
    title: kind?.family ? "Parents" : `${k[0]!.toUpperCase()}${k.slice(1)}`,
    where: "up",
    items: ups(g, id, k).map((u) => ({ key: u, ...(tag(u, id) ? { tag: tag(u, id)! } : {}) })),
  });
  if (kind?.family) {
    const couple = g.kinds.find((x) => x.couple);
    out.push({
      title: "Partners",
      where: "pair",
      items: partners(g, id).map((p) => {
        const e = couple ? edgeOf(g, couple.name, id, p) : undefined;
        const t = e?.when ?? e?.how ?? undefined;
        return { key: p, ...(t ? { tag: t } : {}) };
      }),
    });
  }
  out.push({
    title: kind?.family
      ? "Children"
      : kind?.reverse
        ? `${kind.reverse[0]!.toUpperCase()}${kind.reverse.slice(1)}`
        : "Below",
    where: "down",
    items: downs(g, id, k).map((c) => ({ key: c, ...(tag(id, c) ? { tag: tag(id, c)! } : {}) })),
  });
  const sibs = new Set<string>();
  for (const p of ups(g, id, k)) for (const c of downs(g, p, k)) if (c !== id) sibs.add(c);
  if (sibs.size)
    out.push({
      title: kind?.family ? "Siblings" : "Alongside",
      worked: true,
      items: [...sibs].map((key) => ({ key })),
    });
  for (const other of g.kinds) {
    if (other.reverse || other.couple) continue;
    const list = equals(g, id, other.name);
    if (list.length)
      out.push({
        title: `${other.name[0]!.toUpperCase()}${other.name.slice(1)}s`,
        items: list.map((key) => ({ key })),
      });
  }
  return out;
}

export function Avatar({ g, id }: { g: Graph; id: string }) {
  return (
    <span className="tr-av" aria-hidden="true">
      {g.people.get(id)?.path ? initials(title(g, id)) : "?"}
    </span>
  );
}

/**
 * What the details panel (or the phone's sheet) says about the selected card: its dates, what
 * does not fit, the people round it with + Add, and what can be done from here.
 */
export function PersonDetails({
  g,
  kindName,
  id,
  fine,
  trees,
  onGo,
  onAdd,
  onFine,
  actions,
  compact = false,
}: {
  g: Graph;
  kindName: string;
  id: string;
  fine: string[];
  trees: string[];
  onGo: (key: string) => void;
  onAdd: (where: AddWhere, at: DOMRect) => void;
  onFine: (key: string) => void;
  actions: ReactNode;
  compact?: boolean;
}) {
  const p = g.people.get(id);
  const stub = !p?.path;
  const warnings = warningsOf(g, kindName, id, fine);
  const sections = sectionsOf(g, kindName, id).filter((s) => !compact || s.items.length > 0);
  return (
    <div className={`tr-person${compact ? " is-compact" : ""}`}>
      <div className="tr-person-head">
        <Avatar g={g} id={id} />
        <div>
          <h2>{title(g, id)}</h2>
          <p>
            {[p?.type, p?.dates ? `${p.dates}${p.died != null ? " †" : ""}` : null]
              .filter(Boolean)
              .join(" · ") || (stub ? "No entry yet" : "")}
          </p>
        </div>
      </div>
      {warnings.map((w) => (
        <div key={w.key} className="tr-warnbox" role="note">
          <strong>⚠ Doesn&rsquo;t fit</strong>
          <span>{w.text}</span>
          <div>
            <button type="button" className="quiet" onClick={() => onFine(w.key)}>
              It&rsquo;s right
            </button>
          </div>
        </div>
      ))}
      {stub && (
        <p className="tr-muted">
          No entry yet. The name is kept on the entry that names it; write its entry to add
          relations to it.
        </p>
      )}
      {sections.map((s) => (
        <section key={s.title} className="tr-sec">
          <h3>
            <span>
              {s.title}
              {s.worked && <span className="tr-worked"> · worked out</span>}
            </span>
            {s.where && !stub && (
              <button
                type="button"
                className="tr-add-link"
                onClick={(e) => onAdd(s.where!, e.currentTarget.getBoundingClientRect())}
              >
                + Add
              </button>
            )}
          </h3>
          {s.items.length === 0 ? (
            <p className="tr-muted">None yet.</p>
          ) : (
            <ul>
              {s.items.map((it) => (
                <li key={it.key}>
                  <button
                    type="button"
                    className={`tr-rel${s.worked ? " is-worked" : ""}`}
                    onClick={() => onGo(it.key)}
                  >
                    {title(g, it.key)}
                    {it.tag && <span className="tr-tag-pill">{it.tag}</span>}
                    {!g.people.get(it.key)?.path && <span className="tr-tag-pill">no entry</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
      {!compact && trees.length > 0 && (
        <section className="tr-sec">
          <h3>In trees</h3>
          <p className="tr-muted">{trees.join(", ")}</p>
        </section>
      )}
      <div className="tr-actions">{actions}</div>
    </div>
  );
}

/**
 * One person at a time: parents above, partners beside, siblings, and children grouped by the
 * partner they were had with. A tap moves to that person. The phone's first view of a tree, and
 * the entry's Relations tab.
 */
export function OnePerson({
  g,
  kindName,
  id,
  onGo,
  onAdd,
}: {
  g: Graph;
  kindName: string;
  id: string;
  onGo: (key: string) => void;
  onAdd?: (where: AddWhere, at: DOMRect) => void;
}) {
  const kind = kindNamed(g, kindName);
  const k = kind?.name ?? kindName;
  const stub = !g.people.get(id)?.path;
  const card = (key: string, me = false) => {
    const p = g.people.get(key);
    return (
      <button
        key={key}
        type="button"
        className={`tr-pc${me ? " is-me" : ""}${p?.path ? "" : " is-stub"}`}
        aria-current={me ? "true" : undefined}
        onClick={() => onGo(key)}
      >
        <b>{title(g, key)}</b>
        <small>
          {p?.dates
            ? `${p.dates}${p.died != null ? " †" : ""}`
            : p?.path
              ? (p.type ?? "")
              : "No entry yet"}
        </small>
      </button>
    );
  };
  const add = (where: AddWhere, label: string) =>
    onAdd && !stub ? (
      <button
        type="button"
        className="tr-pc is-add"
        onClick={(e) => onAdd(where, e.currentTarget.getBoundingClientRect())}
      >
        + {label}
      </button>
    ) : null;
  const P = ups(g, id, k);
  const ps = kind?.family ? partners(g, id) : [];
  const kids = downs(g, id, k);
  const groups: { p: string | null; kids: string[] }[] = [];
  for (const p of ps) {
    const list = kids.filter((c) => ups(g, c, k).includes(p));
    if (list.length) groups.push({ p, kids: list });
  }
  const lone = kids.filter((c) => !groups.some((x) => x.kids.includes(c)));
  if (lone.length) groups.push({ p: null, kids: lone });
  const sibs = new Set<string>();
  for (const p of P) for (const c of downs(g, p, k)) if (c !== id) sibs.add(c);
  const upLabel = kind?.family ? "Parents" : (kind?.name ?? k);
  const downLabel = kind?.family ? "Children" : (kind?.reverse ?? "Below");

  return (
    <div className="tr-one">
      <div className="tr-one-lab">{upLabel}</div>
      <div className="tr-one-row">
        {P.map((x) => card(x))}
        {P.length < (kind?.family ? 2 : 1) && add("up", kind?.family ? "parent" : "above")}
      </div>
      <div className="tr-one-line" aria-hidden="true" />
      <div className="tr-one-row">
        {ps[0] && (
          <>
            {card(ps[0])}
            <span className="tr-one-ring" title="Partners">
              ⚭
            </span>
          </>
        )}
        {card(id, true)}
        {ps.slice(1).map((p) => (
          <span key={p} className="tr-one-pair">
            <span className="tr-one-ring" title="Partners">
              ⚭
            </span>
            {card(p)}
          </span>
        ))}
        {kind?.family && add("pair", "partner")}
      </div>
      {sibs.size > 0 && (
        <>
          <div className="tr-one-lab">{kind?.family ? "Siblings" : "Alongside"}</div>
          <div className="tr-one-sibs">
            {[...sibs].map((s) => (
              <button key={s} type="button" onClick={() => onGo(s)}>
                {title(g, s)}
              </button>
            ))}
          </div>
        </>
      )}
      <div className="tr-one-line" aria-hidden="true" />
      <div className="tr-one-lab">{downLabel}</div>
      <div className="tr-one-row is-top">
        {groups.map((grp) => (
          <div key={grp.p ?? "-"} className="tr-one-grp">
            {grp.p ? (
              <small>with {title(g, grp.p).split(" ")[0]}</small>
            ) : ps.length ? (
              <small>with no one shown</small>
            ) : null}
            <div className="tr-one-row">{grp.kids.map((c) => card(c))}</div>
          </div>
        ))}
        {add("down", kind?.family ? "child" : "below")}
      </div>
    </div>
  );
}
