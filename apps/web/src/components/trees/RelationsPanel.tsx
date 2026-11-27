import { X } from "lucide-react";
import { useId, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { findKind, type RelKind, type TreesFile } from "@frontier/schema";
import { readRelations } from "@frontier/vault";
import { ApiFailure, entryUrl, treeUrl } from "../../api.ts";
import {
  addRelation,
  type AddWhere,
  removeRelation,
  useRelations,
  useTrees,
} from "../../trees/data.ts";
import { downs, type Graph, layoutTree, makeGraph, partners, ups } from "../../trees/model.ts";
import {
  isClear,
  ProposedRelation,
  type RelProposal,
  useAcceptClear,
  useMarkInProse,
} from "./ProposedRelation.tsx";
import { useDialogs } from "../Dialogs.tsx";
import { EntryCombobox } from "../EntryCombobox.tsx";
import { usePhone } from "../Shell.tsx";
import { IconButton } from "../ui/IconButton.tsx";
import { useToast } from "../ui/Toast.tsx";
import { AddPicker } from "./AddPicker.tsx";
import { OnePerson } from "./Person.tsx";
import "../../pages/TreePage.css";

const titleOf = (p: string) => p.split("/").pop()!.replace(/\.md$/i, "");

/** The kind to show an entry by: a family when it has one, or else the first it is part of. */
function kindFor(g: Graph, path: string): string {
  const fam = g.kinds.find((k) => k.family);
  const withAny = (k: RelKind) => ups(g, path, k.name).length + downs(g, path, k.name).length > 0;
  if (fam && (withAny(fam) || partners(g, path).length > 0)) return fam.name;
  return g.kinds.find((k) => k.reverse && withAny(k))?.name ?? fam?.name ?? "parent";
}

/**
 * The entry's Relations tab (stage 30): the entry in the middle of its relatives, then its own
 * `relations` rows as written, with + Add a relation, and the trees it is in.
 */
export function RelationsPanel({
  path,
  text,
  editable,
  onChanged,
}: {
  path: string;
  /** The entry's text as shown, for the rows it writes itself. */
  text: string;
  editable: boolean;
  onChanged: () => void;
}) {
  const relations = useRelations();
  const trees = useTrees();
  const navigate = useNavigate();
  const toast = useToast();
  const dialogs = useDialogs();
  const phone = usePhone();
  const ids = useId();
  const written = useMemo(() => readRelations(text), [text]);
  const [word, setWord] = useState("parent");
  const [who, setWho] = useState<{ path: string; title: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picker, setPicker] = useState<{ where: AddWhere; at: DOMRect } | null>(null);
  const g = relations.graph;
  // Stage 31: what the AI proposed from this entry's text, and from others that name it.
  const response = relations.response;
  const proposed = useMemo(() => response?.proposed ?? [], [response]);
  const asRel = (p: (typeof proposed)[number]): RelProposal => ({ ...p, applies: true });
  const mine = proposed.filter((p) => p.path === path).map(asRel);
  const naming = proposed.filter((p) => p.path !== path && p.whoPath === path).map(asRel);
  const gAll = useMemo(
    () => (response && proposed.length > 0 ? makeGraph(response, { proposed: true }) : g),
    [response, proposed.length, g],
  );
  const acceptClear = useAcceptClear();
  const list = useRef<HTMLDivElement>(null);
  useMarkInProse(mine.map((p) => p.quote));

  if (relations.state === "loading" || !g || !gAll)
    return <p className="tr-muted">Loading the relations…</p>;
  const k = kindFor(g, path);
  const inTrees = (trees.value?.trees ?? []).filter((t) => layoutTree(g, t).nodes.has(path));
  const words = g.kinds.flatMap((kd) => (kd.reverse ? [kd.name, kd.reverse] : [kd.name]));

  async function add() {
    if (!who || busy) return;
    setBusy(true);
    setError(null);
    try {
      let what = word;
      if (word === "+new") {
        const made = await newKind();
        if (!made) return;
        what = made;
      }
      await addRelation({ path, what, who: who.path });
      toast({ message: `Saved on this entry: ${what} [[${who.title}]].` });
      setWho(null);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiFailure ? err.message : "It could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  /** Makes a kind of relation where it is typed: its word, and its other way round if it has one. */
  async function newKind(): Promise<string | null> {
    const name = (
      await dialogs.prompt({
        title: "A new kind of relation",
        label: "Word, as written on this entry",
        placeholder: "apprentice of",
        action: "Next",
      })
    )?.trim();
    if (!name) return null;
    if (findKind(g!.kinds, name)) return name;
    const reverse = (
      await dialogs.prompt({
        title: `The other way round from “${name}”`,
        body: "What the other entry would say, such as “master of” for “apprentice of”. Leave it empty if it reads the same both ways, as “rival” does.",
        label: "Other way round",
        action: "Make the kind",
      })
    )?.trim();
    if (reverse === undefined) return null;
    await trees.client.change((f: TreesFile) => ({
      ...f,
      kinds: [...(f.kinds ?? []), { name, ...(reverse ? { reverse } : {}) }],
    }));
    await relations.reload();
    return name;
  }

  return (
    <div className="tr-rel-panel">
      <OnePerson
        g={gAll}
        onProposal={(i) => {
          const op = proposed[i]?.op;
          const el = list.current?.querySelector<HTMLElement>(`[data-op="${op}"]`);
          el?.scrollIntoView({ block: "nearest" });
          el?.querySelector<HTMLButtonElement>('[data-act="accept"]')?.focus();
        }}
        kindName={k}
        id={path}
        onGo={(key) => {
          const to = g.people.get(key)?.path;
          if (to) navigate(entryUrl(to));
        }}
        {...(editable ? { onAdd: (where: AddWhere, at: DOMRect) => setPicker({ where, at }) } : {})}
      />
      {(mine.length > 0 || naming.length > 0) && (
        <div ref={list} className="tr-proposals">
          {mine.length > 0 && (
            <section className="tr-sec">
              <h3>
                <span>Proposed from the text · {mine.length}</span>
                {editable && mine.filter(isClear).length > 1 && (
                  <button
                    type="button"
                    className="tr-add-link"
                    onClick={async () => {
                      await acceptClear(mine);
                      onChanged();
                    }}
                  >
                    Accept the {mine.filter(isClear).length} clear ones
                  </button>
                )}
              </h3>
              <ul className="tr-plist">
                {mine.map((p) => (
                  <li key={p.op}>
                    <ProposedRelation p={p} tag={false} compact onDecided={() => onChanged()} />
                  </li>
                ))}
              </ul>
            </section>
          )}
          {naming.length > 0 && (
            <section className="tr-sec">
              <h3>Proposed in other entries · {naming.length}</h3>
              <ul className="tr-plist">
                {naming.map((p) => (
                  <li key={p.op}>
                    <ProposedRelation
                      p={p}
                      tag={false}
                      compact
                      heading={
                        <p className="tr-muted">
                          From <Link to={entryUrl(p.path)}>{titleOf(p.path)}</Link>&rsquo;s text
                        </p>
                      }
                      onDecided={() => onChanged()}
                    />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
      <section className="tr-sec">
        <h3>As written in this entry</h3>
        {written.problems.length > 0 ? (
          <p className="tr-error">{written.problems.join(" ")} Correct it in the text.</p>
        ) : (
          <ul className="tr-written">
            {written.items.map((item, index) => {
              const known = findKind(g.kinds, item.what);
              return (
                <li key={`${index}-${item.what}-${item.who}`}>
                  <span
                    className={`tr-written-word${known ? "" : " is-unknown"}`}
                    title={
                      known ? undefined : "Not a kind Frontier knows. It is kept and not drawn."
                    }
                  >
                    {item.what}
                  </span>
                  <span>
                    {item.who.replace(/\[\[([^\]|]*)(\|[^\]]*)?\]\]/g, "$1")}
                    {item.with && (
                      <span className="tr-muted">
                        {" "}
                        · with {item.with.replace(/\[\[|\]\]/g, "")}
                      </span>
                    )}
                    {item.how && <span className="tr-muted"> · {item.how}</span>}
                    {item.when && <span className="tr-muted"> · {item.when}</span>}
                  </span>
                  {editable && (
                    <IconButton
                      label={`Remove “${item.what} ${item.who.replace(/\[\[|\]\]/g, "")}”`}
                      icon={X}
                      size="sm"
                      onClick={async () => {
                        try {
                          await removeRelation({ path, index, what: item.what, who: item.who });
                          onChanged();
                        } catch (err) {
                          setError(
                            err instanceof ApiFailure ? err.message : "It could not be removed.",
                          );
                        }
                      }}
                    />
                  )}
                </li>
              );
            })}
            {written.items.length === 0 && <li className="tr-muted">Nothing yet.</li>}
          </ul>
        )}
        {editable && written.problems.length === 0 && (
          <div className="tr-add-row">
            <label className="sr-only" htmlFor={`${ids}-w`}>
              Relation
            </label>
            <select id={`${ids}-w`} value={word} onChange={(e) => setWord(e.target.value)}>
              {words.map((w) => (
                <option key={w} value={w}>
                  {w}
                </option>
              ))}
              <option value="+new">+ A new kind…</option>
            </select>
            <span id={`${ids}-who`} className="sr-only">
              Who
            </span>
            <EntryCombobox
              labelledBy={`${ids}-who`}
              value={who?.path ?? null}
              onChange={(p, t) => setWho(p ? { path: p, title: t } : null)}
            />
            <button
              type="button"
              className="primary"
              disabled={!who || busy}
              onClick={() => void add()}
            >
              Add
            </button>
          </div>
        )}
        {error && (
          <p className="tr-error" role="alert">
            {error}
          </p>
        )}
        <p className="tr-muted">
          A fact is written on one entry, either way round: “child” here or “parent” there. Siblings
          are always worked out.
        </p>
      </section>
      <section className="tr-sec">
        <h3>In trees</h3>
        {inTrees.length === 0 ? (
          <p className="tr-muted">
            None. <Link to="/trees">Make a tree</Link>
          </p>
        ) : (
          <ul>
            {inTrees.map((t) => (
              <li key={t.id}>
                <Link to={treeUrl(t.id)}>{t.name} →</Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      {picker && (
        <AddPicker
          g={g}
          kindName={k}
          where={picker.where}
          from={path}
          anchor={picker.at}
          phone={phone}
          onDone={() => {
            setPicker(null);
            onChanged();
          }}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  );
}
