import { Dices, FilePlus2, House, PanelLeftOpen, Search } from "lucide-react";
import { ConnectionMark } from "../ConnectionMark.tsx";
import { Unsent } from "../Unsent.tsx";
import { IconButton } from "../ui/IconButton.tsx";
import { PersonRow } from "./PersonRow.tsx";
import { ProjectMenu } from "./ProjectMenu.tsx";
import { useCanWrite, useProject } from "../projectContext.ts";
import { PLACES, SideLink, WaitingLinks } from "./LeftBar.tsx";
import "./LeftBar.css";
import "./ProjectMenu.css";
import "./KeepGoing.css";

/**
 * The side bar folded to a narrow rail of icons. It keeps everything but the folder list: search,
 * New entry, the places, what waits with its counts, the connection and the app menu.
 */
export function Rail({
  onExpand,
  onSearch,
  onNewEntry,
  onRandom,
  onKeys,
  onLogout,
}: {
  onExpand: () => void;
  onSearch: () => void;
  onNewEntry: () => void;
  onRandom: () => void;
  onKeys: () => void;
  onLogout: () => void;
}) {
  const project = useProject();
  const canWrite = useCanWrite();
  return (
    <div className="left-bar is-rail">
      <div className="left-head">
        <ProjectMenu rail />
        <IconButton
          label="Unfold the side bar"
          icon={PanelLeftOpen}
          shortcut="app.sidebar"
          tipSide="right"
          className="left-fold"
          onClick={onExpand}
        />
      </div>
      <div className="left-actions">
        <IconButton
          label={`Search ${project.name}`}
          icon={Search}
          shortcut="app.switcher"
          tipSide="right"
          className="find"
          onClick={onSearch}
        />
        {canWrite && (
          <IconButton label="New entry" icon={FilePlus2} tipSide="right" onClick={onNewEntry} />
        )}
        <IconButton
          label="Random entry"
          icon={Dices}
          shortcut="app.random"
          tipSide="right"
          className="left-random"
          onClick={onRandom}
        />
      </div>
      <nav className="left-scroll left-places" aria-label="Places">
        <SideLink to="/" end icon={House} label="Home" rail />
        {PLACES.map((p) => (
          <SideLink key={p.to} to={p.to} icon={p.icon} label={p.label} rail />
        ))}
      </nav>
      <div className="left-foot">
        {canWrite && (
          <nav className="left-waiting" aria-label="Waiting for you">
            <WaitingLinks rail />
          </nav>
        )}
        <div className="left-status">
          <ConnectionMark compact tipSide="right" />
          <Unsent compact />
        </div>
        <PersonRow rail onKeys={onKeys} onLogout={onLogout} />
      </div>
    </div>
  );
}
