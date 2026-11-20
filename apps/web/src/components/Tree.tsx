import type { TreeFolder, TreeResponse } from "@frontier/schema";
import { useState } from "react";
import { NavLink } from "react-router-dom";
import { entryUrl } from "../api.ts";

const byName = (a: { path: string }, b: { path: string }) =>
  a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: "base" });

const nameOf = (path: string) => path.split("/").pop() ?? path;

function Folder({
  folder,
  current,
  depth,
}: {
  folder: TreeFolder;
  current: string;
  depth: number;
}) {
  const holdsCurrent = current.startsWith(folder.path + "/");
  const [open, setOpen] = useState(holdsCurrent || depth === 0);
  const name = nameOf(folder.path);
  // A note named after its folder is the folder's own page; it opens from the folder's name.
  const own = folder.notes.find((n) => nameOf(n.path).toLowerCase() === `${name.toLowerCase()}.md`);
  const notes = folder.notes.filter((n) => n !== own).sort(byName);
  const count = folder.notes.length + folder.folders.length;

  return (
    <li>
      <div className="tree-row">
        <button
          type="button"
          className="twist"
          aria-expanded={open}
          aria-label={`${open ? "Close" : "Open"} ${name}`}
          onClick={() => setOpen(!open)}
        >
          <span aria-hidden="true">{open ? "▾" : "▸"}</span>
        </button>
        {own ? (
          <NavLink to={entryUrl(own.path)} className="tree-folder" onClick={() => setOpen(true)}>
            {name}
          </NavLink>
        ) : (
          <button type="button" className="tree-folder" onClick={() => setOpen(!open)}>
            {name}
          </button>
        )}
        {!open && <span className="count">{count}</span>}
      </div>
      {open && (
        <ul>
          {[...folder.folders].sort(byName).map((f) => (
            <Folder key={f.path} folder={f} current={current} depth={depth + 1} />
          ))}
          {notes.map((n) => (
            <li key={n.path}>
              <NavLink to={entryUrl(n.path)} className="tree-note">
                {nameOf(n.path).replace(/\.md$/i, "")}
              </NavLink>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function Tree({ tree, current }: { tree: TreeResponse; current: string }) {
  return (
    <ul className="tree">
      {[...tree.folders].sort(byName).map((f) => (
        <Folder key={f.path} folder={f} current={current} depth={0} />
      ))}
      {[...tree.notes].sort(byName).map((n) => (
        <li key={n.path}>
          <NavLink to={entryUrl(n.path)} className="tree-note">
            {nameOf(n.path).replace(/\.md$/i, "")}
          </NavLink>
        </li>
      ))}
    </ul>
  );
}
