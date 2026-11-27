import { Keyboard, LogOut, Settings, Layers } from "lucide-react";
import { type ReactNode, useState } from "react";
import { ConfirmBanner } from "../email/ConfirmBanner.tsx";
import { useKeyListener, useShortcut } from "../keys.ts";
import { useMe } from "../me.ts";
import { Link, useNavigate } from "../nav.tsx";
import { NEEDS_CONNECTION, useConnection } from "../sync/connection.ts";
import { KeySheet } from "./KeySheet.tsx";
import { UpdateBar } from "./UpdateBar.tsx";
import { Avatar } from "./ui/Avatar.tsx";
import { Menu, MenuHeading, MenuItem, MenuLink, MenuSeparator } from "./ui/Menu.tsx";
import { useLogoutAction } from "./useLogoutAction.ts";
import "./OutsideShell.css";

/**
 * The frame of a page that belongs to no project (All projects, and Settings opened from it): the
 * wordmark, and you, with the account menu. There is no side bar, since there is no library.
 */
export function OutsideShell({ children }: { children: ReactNode }) {
  const me = useMe();
  const navigate = useNavigate();
  const logout = useLogoutAction();
  const offline = useConnection().state === "offline";
  const [sheet, setSheet] = useState(false);
  useKeyListener();
  useShortcut("app.keys", () => setSheet(true));
  useShortcut("app.projects", () => void navigate("/projects"));
  const shown = me ? me.name || me.email || "Your account" : "Your account";
  return (
    <div className="outside">
      <header className="outside-bar">
        <Link to="/projects" className="wordmark">
          Frontier
        </Link>
        <Menu
          label="Account menu"
          align="end"
          trigger={
            <button type="button" className="outside-account" aria-label={`${shown}, account menu`}>
              {me && <Avatar name={me.name} email={me.email} />}
            </button>
          }
        >
          {me && (
            <>
              <MenuHeading>
                <strong>{shown}</strong>
                {me.name && me.email && <span>{me.email}</span>}
              </MenuHeading>
              <MenuSeparator />
            </>
          )}
          <MenuLink icon={Layers} to="/projects">
            All projects
          </MenuLink>
          <MenuLink icon={Settings} to="/settings">
            Settings
          </MenuLink>
          <MenuItem icon={Keyboard} onSelect={() => setSheet(true)}>
            Keyboard shortcuts
          </MenuItem>
          <MenuSeparator />
          <MenuItem
            icon={LogOut}
            onSelect={logout}
            disabled={offline}
            disabledReason={NEEDS_CONNECTION}
          >
            Log out
          </MenuItem>
        </Menu>
      </header>
      <UpdateBar />
      <ConfirmBanner />
      <main className="outside-main">{children}</main>
      {sheet && <KeySheet onClose={() => setSheet(false)} />}
    </div>
  );
}
