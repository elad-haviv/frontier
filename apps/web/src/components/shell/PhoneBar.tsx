import { GitCompareArrows, Menu as MenuIcon, Search } from "lucide-react";
import { type Ref, useCallback } from "react";
import { ConnectionMark } from "../ConnectionMark.tsx";
import { Unsent } from "../Unsent.tsx";
import { IconButton } from "../ui/IconButton.tsx";
import { SideLink, useCounts } from "./LeftBar.tsx";
import { useShellStore } from "./panels.tsx";
import { useProject } from "../projectContext.ts";
import { useConnection } from "../../sync/connection.ts";
import "./PhoneBar.css";

/**
 * The phone's one slim line: the menu button, the page's title, and its main action. Search
 * stays in reach, and only what needs the author now (no connection, unsent changes, texts to
 * compare) joins the line; everything else is in the drawer.
 */
export function PhoneBar({
  title,
  open,
  onMenu,
  onSearch,
  menuRef,
}: {
  /** The page's usual name, when the page set none of its own. */
  title: string;
  open: boolean;
  onMenu: () => void;
  onSearch: () => void;
  menuRef: Ref<HTMLButtonElement>;
}) {
  const project = useProject();
  const store = useShellStore();
  const counts = useCounts();
  const { state } = useConnection();
  const shown = store.title;
  const slot = useCallback((el: HTMLSpanElement | null) => store.setActionSlot(el), [store]);
  const waiting = counts.waiting + counts.inbox > 0;
  return (
    <header className="phone-bar">
      <span className="phone-menu">
        <IconButton
          ref={menuRef}
          className="menu"
          label="Open the side bar"
          icon={MenuIcon}
          tipSide="bottom"
          aria-expanded={open}
          aria-haspopup="dialog"
          onClick={onMenu}
        />
        {waiting && <span className="phone-dot" aria-hidden="true" />}
      </span>
      <span className="phone-title">
        <span className="phone-title-text">{shown ? shown.title : title}</span>
        {shown?.extra}
      </span>
      <span className="phone-marks">
        {state !== "online" && <ConnectionMark />}
        <Unsent />
        {counts.compare > 0 && (
          <SideLink
            to="/status"
            icon={GitCompareArrows}
            label="Compare"
            badge={counts.compare}
            className="is-alert phone-compare"
            title="Texts from other devices, kept beside a draft for you to compare"
          />
        )}
      </span>
      <IconButton
        className="find"
        label={`Search ${project.name}`}
        icon={Search}
        shortcut="app.switcher"
        tipSide="bottom"
        onClick={onSearch}
      />
      <span className="phone-action" ref={slot} />
    </header>
  );
}
