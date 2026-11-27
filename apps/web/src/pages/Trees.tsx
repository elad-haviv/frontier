import { Plus } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "../nav.tsx";
import type { TreeLine, TreeLook, TreesFile } from "@frontier/schema";
import { treeUrl } from "../api.ts";
import { DialogFrame } from "../components/Dialogs.tsx";
import { EntryCombobox } from "../components/EntryCombobox.tsx";
import { useCanWrite } from "../components/projectContext.ts";
import { usePhone } from "../components/Shell.tsx";
import { usePageTitle } from "../components/shell/panels.tsx";
import { TreeShape } from "../components/trees/TreeDrawing.tsx";
import { Icon } from "../components/ui/Icon.tsx";
import { Problem } from "../components/ui/Problem.tsx";
import { Progress } from "../components/ui/Progress.tsx";
import { useScope, useShortcut } from "../keys.ts";
import { newTreeId, useRelations, useTrees } from "../trees/data.ts";
import { biggestFamily, type Graph, layoutTree, title } from "../trees/model.ts";
import "./TreePage.css";

const LOOKS: {
  look: TreeLook;
  title: string;
  sub: string;
  kind: string;
  dir: "down" | "right";
  glyph: string;
}[] = [
  {
    look: "family",
    title: "Family tree",
    sub: "Parents and partners, by generation",
    kind: "parent",
    dir: "down",
    glyph:
      "M4 2h14v8H4z M26 2h14v8H26z M18 6h8 M22 6v12 M12 18h20 M12 18v6 M32 18v6 M5 24h14v8H5z M25 24h14v8H25z",
  },
  {
    look: "descent",
    title: "Descent",
    sub: "What descends from what, left to right",
    kind: "descends from",
    dir: "right",
    glyph: "M1 13h12v8H1z M13 17h5 M18 6v22 M18 6h6 M18 28h6 M24 2h12v8H24z M24 24h12v8H24z",
  },
  {
    look: "hierarchy",
    title: "Hierarchy",
    sub: "Who serves or reports to whom",
    kind: "serves",
    dir: "down",
    glyph:
      "M15 1h14v8H15z M22 9v6 M8 15h28 M8 15v7 M22 15v7 M36 15v7 M2 22h12v8H2z M16 22h12v8H16z M30 22h12v8H30z",
  },
  {
    look: "other",
    title: "Something else",
    sub: "Apprentice of, vassal of, founded by…",
    kind: "",
    dir: "down",
    glyph: "M15 2h14v8H15z M22 10v4 M22 17v5 M15 22h14v8H15z",
  },
];

/** The Trees page (stage 30): a card for each saved tree, and the New tree dialog. */
export function TreesPage() {
  const trees = useTrees();
  const relations = useRelations();
  const phone = usePhone();
  const navigate = useNavigate();
  // A reader opens the trees and the relations; making and changing them is for writers.
  const canWrite = useCanWrite();
  const [making, setMaking] = useState<{ start?: string } | null>(null);
  usePageTitle("Trees");
  useScope("trees");
  useShortcut("trees.new", () => {
    if (!canWrite) return false;
    setMaking({});
  });

  if (trees.state === "failed")
    return <Problem reason={trees.error ?? "The trees could not be read."} />;
  if (trees.state === "loading") return <Progress label="Loading the trees" />;
  const list = trees.value?.trees ?? [];
  const g = relations.graph;
  const family = g ? biggestFamily(g) : null;

  async function quick() {
    if (!family || !g) return;
    const id = newTreeId();
    const name = `House ${title(g, family.start).split(" ").slice(-1)[0]}`;
    await trees.client.change((f) => ({
      ...f,
      trees: [
        ...f.trees,
        { id, name, kind: "parent", look: "family", start: family.start, dir: "down" },
      ],
    }));
    navigate(treeUrl(id));
  }

  return (
    <article className="tr-list-page">
      <header className="tr-list-head">
        <h1>Trees</h1>
        {list.length > 0 && (
          <span className="tr-muted">{list.length === 1 ? "1 tree" : `${list.length} trees`}</span>
        )}
        <span className="tr-spacer" />
        {canWrite && list.length > 0 && !phone && (
          <button type="button" className="primary" onClick={() => setMaking({})}>
            <Icon icon={Plus} size="sm" /> New tree <kbd>N</kbd>
          </button>
        )}
      </header>
      {relations.state === "failed" && (
        <Problem reason={relations.error ?? "The relations could not be read."} />
      )}
      {list.length === 0 ? (
        <div className="tr-empty">
          <svg width="120" height="80" viewBox="0 0 120 80" aria-hidden="true">
            <g fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="44" y="4" width="32" height="16" rx="4" />
              <rect x="8" y="58" width="32" height="16" rx="4" />
              <rect x="44" y="58" width="32" height="16" rx="4" />
              <rect x="80" y="58" width="32" height="16" rx="4" strokeDasharray="4 3" />
              <path d="M60 20 C60 40 24 38 24 58 M60 20 V58 M60 20 C60 40 96 38 96 58" />
            </g>
          </svg>
          <h2>No trees yet</h2>
          <p>
            A tree draws how entries relate: a family, the descent of a kind of creature, a
            pantheon, a chain of command. The relations are written on the entries, so every tree
            that shows them stays in step.
          </p>
          {canWrite ? (
            <>
              <button type="button" className="primary" onClick={() => setMaking({})}>
                New tree
              </button>
              {family && g && (
                <button type="button" onClick={() => void quick()}>
                  Make a tree from {title(g, family.start)} · {family.size} people already related
                </button>
              )}
              <p className="tr-muted">Or open someone&rsquo;s entry and use its Relations tab.</p>
            </>
          ) : (
            <p className="tr-muted">
              A writer or an owner of the project can make one. Open someone&rsquo;s entry and use
              its Relations tab to see how they relate.
            </p>
          )}
        </div>
      ) : (
        <ul className="tr-grid">
          {list.map((t) => (
            <li key={t.id}>
              <TreeCard tree={t} g={g} />
            </li>
          ))}
          {canWrite && !phone && (
            <li>
              <button type="button" className="tr-new-tile" onClick={() => setMaking({})}>
                + New tree
              </button>
            </li>
          )}
        </ul>
      )}
      {canWrite && phone && list.length > 0 && (
        <button
          type="button"
          className="tr-fab"
          aria-label="New tree"
          onClick={() => setMaking({})}
        >
          <Icon icon={Plus} />
        </button>
      )}
      {making && canWrite && (
        <NewTree
          onCancel={() => setMaking(null)}
          onMake={async (line) => {
            await trees.client.change((f: TreesFile) => ({ ...f, trees: [...f.trees, line] }));
            setMaking(null);
            navigate(treeUrl(line.id));
          }}
          g={g}
        />
      )}
    </article>
  );
}

function TreeCard({ tree, g }: { tree: TreeLine; g: Graph | null }) {
  const L = useMemo(
    () => (g ? layoutTree(g, { ...tree, gens: undefined, folded: [] }) : null),
    [g, tree],
  );
  const look = LOOKS.find((l) => l.look === tree.look)?.title ?? "Tree";
  return (
    <Link to={treeUrl(tree.id)} className="tr-card-link">
      <span className="tr-pic">{L && <TreeShape layout={L} />}</span>
      <span className="tr-card-text">
        <span className="tr-card-title">{tree.name}</span>
        <span className="tr-muted">
          <span className="tr-badge">{look}</span>
          {L ? `${L.nodes.size} ${L.nodes.size === 1 ? "entry" : "entries"}` : ""}
        </span>
        <span className="tr-muted">
          from {g ? title(g, tree.start) : tree.start.split("/").pop()?.replace(/\.md$/, "")}
        </span>
      </span>
    </Link>
  );
}

function NewTree({
  g,
  onCancel,
  onMake,
}: {
  g: Graph | null;
  onCancel: () => void;
  onMake: (line: TreeLine) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [look, setLook] = useState<TreeLook>("family");
  const [other, setOther] = useState("");
  const [start, setStart] = useState<{ path: string; title: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const nameBox = useRef<HTMLInputElement>(null);
  const choice = LOOKS.find((l) => l.look === look)!;
  const otherKinds = (g?.kinds ?? []).filter((k) => k.reverse && !k.family);
  const kind = look === "other" ? other || otherKinds[0]?.name || "serves" : choice.kind;
  const ready = name.trim() !== "" && start !== null && !busy;

  async function make() {
    if (!ready) return;
    setBusy(true);
    await onMake({
      id: newTreeId(),
      name: name.trim(),
      kind,
      look,
      start: start!.path,
      dir: choice.dir,
    });
  }

  return (
    <DialogFrame
      title="New tree"
      onCancel={onCancel}
      onSubmit={() => void make()}
      initialFocus={nameBox}
      className="tr-new"
    >
      <label className="dialog-field">
        Name
        <input
          ref={nameBox}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="House Vane, The wyrm lines…"
        />
      </label>
      <fieldset className="tr-looks">
        <legend>What it shows</legend>
        {LOOKS.map((l) => (
          <button
            key={l.look}
            type="button"
            className="tr-look"
            aria-pressed={look === l.look}
            onClick={() => setLook(l.look)}
          >
            <svg viewBox="0 0 44 34" aria-hidden="true">
              <path d={l.glyph} />
            </svg>
            <span>
              <b>{l.title}</b>
              <span>{l.sub}</span>
            </span>
          </button>
        ))}
      </fieldset>
      {look === "other" && (
        <label className="dialog-field">
          Built from
          <select value={kind} onChange={(e) => setOther(e.target.value)}>
            {otherKinds.map((k) => (
              <option key={k.name} value={k.name}>
                {k.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="dialog-field">
        <span id="tr-start-label">Start from</span>
        <EntryCombobox
          labelledBy="tr-start-label"
          value={start?.path ?? null}
          onChange={(path, t) => setStart(path ? { path, title: t } : null)}
        />
        <span className="tr-muted">
          {look === "family"
            ? "A founder, or the oldest ancestor you know."
            : look === "descent"
              ? "The oldest form."
              : "Who is at the top."}{" "}
          You can start from someone else later.
        </span>
      </div>
      <p className="dialog-actions">
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="primary" disabled={!ready}>
          Make the tree
        </button>
      </p>
    </DialogFrame>
  );
}
