import { ArrowLeft } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { RelationsResponse, TreeLine, TreesFile } from "@frontier/schema";
import { entryUrl } from "../api.ts";
import { useDialogs } from "../components/Dialogs.tsx";
import { usePhone } from "../components/Shell.tsx";
import { usePageTitle } from "../components/shell/panels.tsx";
import { AddPicker } from "../components/trees/AddPicker.tsx";
import { FindRelations } from "../components/trees/FindRelations.tsx";
import { ProposedRelation } from "../components/trees/ProposedRelation.tsx";
import { OnePerson, PersonDetails } from "../components/trees/Person.tsx";
import { TreeDrawing, type TreeDrawingHandle } from "../components/trees/TreeDrawing.tsx";
import { Icon } from "../components/ui/Icon.tsx";
import { Menu, MenuItem } from "../components/ui/Menu.tsx";
import { Problem } from "../components/ui/Problem.tsx";
import { Progress } from "../components/ui/Progress.tsx";
import { useScope, useShortcut } from "../keys.ts";
import { type AddWhere, changeTree, useRelations, useTrees } from "../trees/data.ts";
import {
  above,
  describe,
  type Graph,
  kindNamed,
  type Kinship,
  layoutTree,
  relate,
  title,
  warningsOf,
  makeGraph,
} from "../trees/model.ts";
import "./TreePage.css";
import "../components/trees/ProposedRelation.css";

const PHONE_VIEW = "frontier.trees.phoneView";
const LAST = "frontier.trees.selected.";
const read = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* kept for this visit only */
  }
};

/** "Descendants of", "Ancestors of" for a family; plainer words for other trees. */
function wayWords(g: Graph, t: TreeLine) {
  const kind = kindNamed(g, t.kind);
  if (kind?.family) return { down: "Descendants of", up: "Ancestors of" };
  return { down: "Everything below", up: "Everything above" };
}

/** One tree (stage 30): drawn from the relations on the entries, saved as a view in the trees file. */
export function TreePage() {
  const { id } = useParams();
  const trees = useTrees();
  const relations = useRelations();
  const tree = trees.value?.trees.find((t) => t.id === id);
  usePageTitle(tree?.name ?? "Tree");

  if (trees.state === "failed")
    return <Problem reason={trees.error ?? "The trees could not be read."} />;
  if (relations.state === "failed")
    return (
      <Problem
        reason={relations.error ?? "The relations could not be read."}
        onRetry={() => void relations.reload()}
      />
    );
  if (
    trees.state === "loading" ||
    relations.state === "loading" ||
    !relations.graph ||
    !relations.response
  )
    return <Progress label="Loading the tree" />;
  if (!tree)
    return (
      <div className="tr-page-message">
        <p>There is no such tree. It may have been deleted.</p>
        <Link to="/trees">All trees</Link>
      </div>
    );
  return (
    <Tree
      key={tree.id}
      g={relations.graph}
      response={relations.response}
      tree={tree}
      fine={trees.value?.fine ?? []}
      allTrees={trees.value!.trees}
      change={(fn) => trees.client.change(fn)}
    />
  );
}

function Tree({
  g,
  response,
  tree,
  fine,
  allTrees,
  change,
}: {
  /** The relations as written; checks and kinship use only these. */
  g: Graph;
  response: RelationsResponse;
  tree: TreeLine;
  fine: string[];
  allTrees: TreeLine[];
  change: (fn: (f: TreesFile) => TreesFile) => Promise<void>;
}) {
  const phone = usePhone();
  const navigate = useNavigate();
  const dialogs = useDialogs();
  const drawing = useRef<TreeDrawingHandle>(null);
  const findBox = useRef<HTMLInputElement>(null);
  const kind = kindNamed(g, tree.kind);
  const k = kind?.name ?? tree.kind;
  const [selected, setSelected] = useState<string | null>(() => {
    const last = read(LAST + tree.id);
    return last && g.people.has(last) ? last : tree.start;
  });
  const [compareFrom, setCompareFrom] = useState<string | null>(null);
  const [compareTo, setCompareTo] = useState<string | null>(null);
  const [find, setFind] = useState("");
  const [picker, setPicker] = useState<{
    where: AddWhere;
    from: string;
    at: DOMRect | null;
  } | null>(null);
  const [phoneView, setPhoneView] = useState<"one" | "tree">(() =>
    read(PHONE_VIEW) === "tree" ? "tree" : "one",
  );

  const update = (fn: (t: TreeLine) => TreeLine) => void changeTree(change, tree.id, fn);
  // Stage 31: what the AI proposed is drawn too, unless this tree hides it.
  const proposed = response.proposed ?? [];
  const gAll = useMemo(
    () =>
      tree.hideProposed || proposed.length === 0 ? g : makeGraph(response, { proposed: true }),
    [g, response, tree.hideProposed, proposed.length],
  );
  const [selProp, setSelProp] = useState<number | null>(null);
  const [finding, setFinding] = useState(false);
  const L = useMemo(() => layoutTree(gAll, tree), [gAll, tree]);
  const withAll = useMemo(
    () => (proposed.length ? layoutTree(makeGraph(response, { proposed: true }), tree) : null),
    [response, tree, proposed.length],
  );
  const proposedHere = withAll
    ? new Set(withAll.edges.filter((e) => e.proposal !== null).map((e) => e.proposal!)).size
    : 0;
  const shownProposal = selProp !== null && !tree.hideProposed ? proposed[selProp] : undefined;
  const visible = [...L.nodes.keys()];
  const kinship: Kinship | null = useMemo(
    () => (compareFrom && compareTo ? relate(g, k, compareFrom, compareTo) : null),
    [g, k, compareFrom, compareTo],
  );
  const matches = useMemo(() => {
    const q = find.trim().toLowerCase();
    return new Set(q ? visible.filter((key) => title(g, key).toLowerCase().includes(q)) : []);
  }, [find, g, L]);
  const warned = visible.filter((key) => warningsOf(g, k, key, fine).length > 0);
  const words = wayWords(g, tree);
  const upFrom =
    tree.way === "up"
      ? (tree.from ?? tree.start)
      : selected && g.people.get(selected)?.path
        ? selected
        : tree.start;

  useEffect(() => {
    if (selected) write(LAST + tree.id, selected);
  }, [selected, tree.id]);

  useScope("tree");
  useShortcut("tree.find", () => {
    if (!findBox.current) return false;
    findBox.current.focus();
  });
  useShortcut("tree.add", () => {
    if (!selected || !g.people.get(selected)?.path) return false;
    setPicker({ where: tree.way === "up" ? "up" : "down", from: selected, at: null });
  });
  useShortcut("tree.compare", () => {
    if (!selected) return false;
    setCompareFrom(selected);
    setCompareTo(null);
  });
  useShortcut("tree.fit", () => drawing.current?.fit());
  useShortcut("tree.zoomIn", () => drawing.current?.zoom(1.25));
  useShortcut("tree.zoomOut", () => drawing.current?.zoom(0.8));

  function select(key: string, second: boolean) {
    setPicker(null);
    if ((compareFrom && !compareTo) || (second && selected && selected !== key)) {
      const from = compareFrom ?? selected!;
      setCompareFrom(from);
      if (key !== from) setCompareTo(key);
    } else {
      setCompareFrom(null);
      setCompareTo(null);
    }
    setSelected(key);
  }
  function clear() {
    if (compareFrom) {
      setCompareFrom(null);
      setCompareTo(null);
    } else setPicker(null);
  }
  function open(key: string) {
    const path = g.people.get(key)?.path;
    if (path) navigate(entryUrl(path));
  }
  function fold(key: string) {
    const node = L.nodes.get(key);
    update((t) => {
      const folded = new Set(t.folded ?? []);
      const opened = new Set(t.opened ?? []);
      if (node?.folded) {
        folded.delete(key);
        opened.add(key);
      } else {
        folded.add(key);
        opened.delete(key);
      }
      return { ...t, folded: [...folded], opened: [...opened] };
    });
  }
  /** Finds in the whole tree, folded parts included, and unfolds the way to the match. */
  function findNow() {
    const q = find.trim().toLowerCase();
    if (!q) return;
    const all = layoutTree(gAll, { ...tree, gens: undefined, folded: [] });
    const hit = [...all.nodes.keys()].find((key) => title(g, key).toLowerCase().includes(q));
    if (!hit) return;
    if (!L.nodes.has(hit)) {
      const way = [...above(g, all.nodes.get(hit)!.owner, k).keys()];
      update((t) => ({
        ...t,
        folded: (t.folded ?? []).filter((f) => !way.includes(f)),
        opened: [...new Set([...(t.opened ?? []), ...way])],
      }));
    }
    setSelected(hit);
    window.setTimeout(() => drawing.current?.reveal(hit), 50);
  }
  function added(key: string) {
    setPicker(null);
    setSelected(key);
    window.setTimeout(() => drawing.current?.reveal(key), 80);
  }
  const markFine = (key: string) =>
    void change((f) => ({ ...f, fine: [...new Set([...(f.fine ?? []), key])] }));

  async function rename() {
    const name = await dialogs.prompt({
      title: "Rename the tree",
      label: "Name",
      initial: tree.name,
      action: "Rename",
    });
    if (name?.trim()) update((t) => ({ ...t, name: name.trim() }));
  }
  async function remove() {
    const ok = await dialogs.confirm({
      title: `Delete the tree "${tree.name}"?`,
      body: "Only the tree goes. The relations stay on the entries, and other trees still show them.",
      action: "Delete the tree",
      danger: true,
    });
    if (!ok) return;
    await change((f) => ({ ...f, trees: f.trees.filter((t) => t.id !== tree.id) }));
    navigate("/trees");
  }

  const overlays = g.kinds.filter(
    (x) =>
      !x.reverse &&
      !(kind?.family && x.couple) &&
      g.edges.some((e) => e.kind === x.name && (L.nodes.has(e.a) || L.nodes.has(e.b))),
  );
  const inTrees = (key: string) =>
    allTrees.filter((t) => layoutTree(g, t).nodes.has(key)).map((t) => t.name);
  const sel = selected && g.people.has(selected) ? selected : null;
  const actions = sel ? (
    <>
      {g.people.get(sel)?.path && (
        <button type="button" onClick={() => open(sel)}>
          Open entry
        </button>
      )}
      <button
        type="button"
        onClick={() => {
          setCompareFrom(sel);
          setCompareTo(null);
          if (phone) setPhoneView("tree");
        }}
      >
        How are they related… <kbd>C</kbd>
      </button>
      {g.people.get(sel)?.path && sel !== (tree.way === "up" ? tree.from : tree.start) && (
        <button
          type="button"
          onClick={() =>
            update((t) =>
              t.way === "up" ? { ...t, from: sel } : { ...t, start: sel, folded: [], opened: [] },
            )
          }
        >
          Start the tree here
        </button>
      )}
    </>
  ) : null;
  const proposalBox = shownProposal ? (
    <div className="tr-proposal-box">
      <ProposedRelation
        key={`${shownProposal.proposal}${shownProposal.op}`}
        p={{ ...shownProposal, applies: true }}
        tag={false}
        compact
        heading={<h3>Proposed from {title(g, shownProposal.path)}&rsquo;s text</h3>}
        onDecided={(key) => {
          setSelProp(null);
          if (key) setSelected(key);
        }}
      />
    </div>
  ) : null;
  const details = sel ? (
    <PersonDetails
      g={gAll}
      checks={g}
      onProposal={(i) => setSelProp(i)}
      kindName={k}
      id={sel}
      fine={fine}
      trees={inTrees(sel)}
      onGo={(key) => {
        select(key, false);
        drawing.current?.reveal(key);
      }}
      onAdd={(where, at) => setPicker({ where, from: sel, at })}
      onFine={markFine}
      actions={actions}
      compact={phone}
    />
  ) : null;

  const lonely = L.nodes.size === 1;
  const showOne = phone && phoneView === "one";

  return (
    <div className="tr-page">
      <header className="tr-head">
        <Link to="/trees" className="tr-back" aria-label="All trees">
          <Icon icon={ArrowLeft} />
        </Link>
        <h1>{tree.name}</h1>
        <span className="tr-pill">
          <b>
            {
              { family: "Family tree", descent: "Descent", hierarchy: "Hierarchy", other: "Tree" }[
                tree.look
              ]
            }
          </b>
          {!kind?.family && <> · {k}</>}
        </span>
        <div className="tr-seg" role="group" aria-label="Which way">
          <button
            type="button"
            aria-pressed={tree.way !== "up"}
            onClick={() => update((t) => ({ ...t, way: "down" }))}
          >
            {words.down} {title(g, tree.start)}
          </button>
          <button
            type="button"
            aria-pressed={tree.way === "up"}
            onClick={() => update((t) => ({ ...t, way: "up", from: upFrom }))}
          >
            {words.up} {title(g, upFrom)}
          </button>
        </div>
        {warned.length > 0 && (
          <button
            type="button"
            className="tr-pill is-red"
            onClick={() => {
              setSelected(warned[0]!);
              drawing.current?.reveal(warned[0]!);
            }}
          >
            ⚠ {warned.length} doesn&rsquo;t fit
          </button>
        )}
        <span className="tr-spacer" />
        <Menu label="More about this tree">
          <MenuItem onSelect={() => void rename()}>Rename…</MenuItem>
          <MenuItem onSelect={() => void remove()}>Delete the tree…</MenuItem>
        </Menu>
      </header>

      <div className="tr-tools">
        {phone ? (
          <div className="tr-seg" role="group" aria-label="View">
            <button
              type="button"
              aria-pressed={phoneView === "tree"}
              onClick={() => {
                setPhoneView("tree");
                write(PHONE_VIEW, "tree");
              }}
            >
              Tree
            </button>
            <button
              type="button"
              aria-pressed={phoneView === "one"}
              onClick={() => {
                setPhoneView("one");
                write(PHONE_VIEW, "one");
              }}
            >
              One at a time
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="primary"
            disabled={!sel || !g.people.get(sel)?.path}
            onClick={(e) =>
              sel &&
              setPicker({
                where: tree.way === "up" ? "up" : "down",
                from: sel,
                at: e.currentTarget.getBoundingClientRect(),
              })
            }
          >
            + Add <kbd>A</kbd>
          </button>
        )}
        {!showOne && (
          <>
            <label className="tr-find">
              <span className="sr-only">Find in this tree</span>
              <input
                ref={findBox}
                type="search"
                placeholder="Find in this tree"
                value={find}
                onChange={(e) => setFind(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") findNow();
                  if (e.key === "Escape") setFind("");
                }}
              />
            </label>
            {!phone && (
              <button type="button" onClick={() => drawing.current?.fit()}>
                Fit <kbd>F</kbd>
              </button>
            )}
            {!phone && (
              <button type="button" onClick={() => setFinding(true)}>
                Find relations…
              </button>
            )}
            <span className="tr-spacer" />
            {proposedHere > 0 && (
              <button
                type="button"
                className="tr-chip-btn"
                aria-pressed={!tree.hideProposed}
                onClick={() => {
                  setSelProp(null);
                  update((t) => {
                    const next = { ...t };
                    if (t.hideProposed) delete next.hideProposed;
                    else next.hideProposed = true;
                    return next;
                  });
                }}
              >
                <span className="tr-qdot" aria-hidden="true">
                  ?
                </span>
                Proposed · {proposedHere}
              </button>
            )}
            {overlays.map((o) => {
              const on = (tree.show ?? []).includes(o.name);
              return (
                <button
                  key={o.name}
                  type="button"
                  className="tr-chip-btn"
                  aria-pressed={on}
                  onClick={() =>
                    update((t) => ({
                      ...t,
                      show: on
                        ? (t.show ?? []).filter((x) => x !== o.name)
                        : [...(t.show ?? []), o.name],
                    }))
                  }
                >
                  {o.name === "rival" ? "Rivals" : `${o.name[0]!.toUpperCase()}${o.name.slice(1)}`}
                </button>
              );
            })}
            {tree.way !== "up" && !phone && (
              <div className="tr-seg" role="group" aria-label="Generations shown">
                {[2, 3].map((n) => (
                  <button
                    key={n}
                    type="button"
                    aria-pressed={tree.gens === n}
                    onClick={() => update((t) => ({ ...t, gens: n, opened: [], folded: [] }))}
                  >
                    {n} gen.
                  </button>
                ))}
                <button
                  type="button"
                  aria-pressed={tree.gens === undefined}
                  onClick={() =>
                    update((t) => {
                      const next = { ...t, opened: [], folded: [] };
                      delete next.gens;
                      return next;
                    })
                  }
                >
                  All
                </button>
              </div>
            )}
            {!phone && (
              <div className="tr-seg" role="group" aria-label="Direction">
                <button
                  type="button"
                  aria-pressed={tree.dir === "down"}
                  onClick={() => update((t) => ({ ...t, dir: "down" }))}
                >
                  ↓ Down
                </button>
                <button
                  type="button"
                  aria-pressed={tree.dir === "right"}
                  onClick={() => update((t) => ({ ...t, dir: "right" }))}
                >
                  → Right
                </button>
              </div>
            )}
          </>
        )}
      </div>

      <div className="tr-body">
        {showOne ? (
          <div className="tr-one-scroll">
            <OnePerson
              g={gAll}
              onProposal={(i) => setSelProp(i)}
              kindName={k}
              id={sel ?? tree.start}
              onGo={(key) => setSelected(key)}
              onAdd={(where) => setPicker({ where, from: sel ?? tree.start, at: null })}
            />
            {sel && (
              <div className="tr-one-actions">
                <div className="tr-actions">{actions}</div>
              </div>
            )}
          </div>
        ) : (
          <div className="tr-canvas">
            <TreeDrawing
              ref={drawing}
              g={gAll}
              checks={g}
              selectedProposal={selProp}
              onProposal={(i) => {
                setPicker(null);
                setSelProp(i);
              }}
              proposalLabel={(i) => {
                const p = proposed[i]!;
                return `Proposed: ${title(g, p.path)}, ${p.word} ${p.whoPath ? title(g, p.whoPath) : p.who}. Open it to decide.`;
              }}
              tree={tree}
              layout={L}
              selected={sel}
              compare={kinship}
              matches={matches}
              fine={fine}
              phone={phone}
              label={tree.name}
              said={sel ? describe(g, k, sel, fine) : ""}
              onSelect={select}
              onClear={clear}
              onOpen={open}
              onAdd={(where, key, at) => {
                setSelected(key);
                setPicker({ where, from: key, at });
              }}
              onFold={fold}
            />
            {!kinship && !compareFrom && proposedHere > 0 && !tree.hideProposed && (
              <p className="tr-proposed-note">
                <span>
                  <span className="tr-qdot" aria-hidden="true">
                    ?
                  </span>
                  {proposedHere} {proposedHere === 1 ? "relation" : "relations"} proposed from the
                  text, drawn dotted. They count in nothing until you accept them.
                </span>
                <Link to="/inbox">All in the inbox</Link>
              </p>
            )}
            {(kinship || compareFrom) && (
              <div className="tr-banner" role="status">
                {kinship ? (
                  <strong>{kinship.text}</strong>
                ) : (
                  <span>Pick someone to compare with {title(g, compareFrom!)}.</span>
                )}
                <button type="button" className="quiet" onClick={clear}>
                  {kinship ? "Done" : "Cancel"}
                </button>
              </div>
            )}
            {lonely && (
              <p className="tr-hint-card">
                Add who comes above, beside and below. Select the card and use its +, or press{" "}
                <kbd>A</kbd>. Picking an entry links it; a new name can wait for its entry.
              </p>
            )}
            <div className="tr-zoom">
              <button
                type="button"
                aria-label="Zoom in"
                onClick={() => drawing.current?.zoom(1.25)}
              >
                +
              </button>
              <button
                type="button"
                aria-label="Zoom out"
                onClick={() => drawing.current?.zoom(0.8)}
              >
                −
              </button>
              {phone && (
                <button
                  type="button"
                  aria-label="Show the whole tree"
                  onClick={() => drawing.current?.fit()}
                >
                  ⤢
                </button>
              )}
            </div>
            {phone && proposalBox && !picker && (
              <div className="tr-sheet" role="region" aria-label="Proposed relation">
                <button
                  type="button"
                  className="tr-sheet-close quiet"
                  aria-label="Close"
                  onClick={() => setSelProp(null)}
                >
                  ×
                </button>
                {proposalBox}
              </div>
            )}
            {phone && details && !picker && !proposalBox && (
              <div className="tr-sheet" role="region" aria-label={title(g, sel!)}>
                <button
                  type="button"
                  className="tr-sheet-close quiet"
                  aria-label="Close"
                  onClick={() => setSelected(null)}
                >
                  ×
                </button>
                {details}
              </div>
            )}
          </div>
        )}
        {!phone && (
          <aside className="tr-panel" aria-label="Selected">
            {proposalBox}
            {details ?? (
              <p className="tr-muted">
                Select someone to see how they relate, to add around them, or to compare two.
                Shift-click a second card to compare.
              </p>
            )}
          </aside>
        )}
      </div>
      {!phone && (
        <p className="tr-foot">
          The relations are written on the entries. This tree keeps only where it starts, what it
          shows and what is folded.
        </p>
      )}
      {finding && <FindRelations unread={response.unread ?? 0} onClose={() => setFinding(false)} />}
      {picker && (
        <AddPicker
          g={g}
          kindName={k}
          where={picker.where}
          from={picker.from}
          anchor={picker.at}
          phone={phone}
          onDone={added}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  );
}
