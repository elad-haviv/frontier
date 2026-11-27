import { Activity, Download, History, Keyboard, LogOut, Settings, Upload } from "lucide-react";
import { useMe } from "../../me.ts";
import { NEEDS_CONNECTION, useConnection } from "../../sync/connection.ts";
import { useCanWriteOrNot } from "../projectContext.ts";
import { Menu, MenuHeading, MenuItem, MenuLink, MenuSeparator } from "../ui/Menu.tsx";

/**
 * The pages for looking after the library, and leaving: the "⋯" at the foot of the side bar.
 * Daily places sit in the side bar itself; these are rarer, so they wait behind one press.
 */
export function AppMenu({
  onKeys,
  onLogout,
  align = "start",
}: {
  onKeys: () => void;
  onLogout: () => void;
  align?: "start" | "end";
}) {
  const offline = useConnection().state === "offline";
  const me = useMe();
  const canWrite = useCanWriteOrNot();
  return (
    <Menu label="App menu" className="app-menu" align={align}>
      {me && (
        <>
          <MenuHeading>
            <strong>{me.name || me.email || "Your account"}</strong>
            {me.name && me.email && <span>{me.email}</span>}
          </MenuHeading>
          <MenuSeparator />
        </>
      )}
      {canWrite && (
        <MenuLink icon={Upload} to="/import">
          Import
        </MenuLink>
      )}
      <MenuLink icon={Download} to="/export">
        Export
      </MenuLink>
      <MenuLink icon={History} to="/versions">
        History of the library
      </MenuLink>
      <MenuLink icon={Settings} to="/settings">
        Settings
      </MenuLink>
      <MenuLink icon={Activity} to="/status">
        Status
      </MenuLink>
      <MenuItem icon={Keyboard} onSelect={onKeys}>
        Keyboard shortcuts
      </MenuItem>
      <MenuSeparator />
      {/* Only the server's answer ends the session, so leaving needs it. */}
      <MenuItem
        icon={LogOut}
        onSelect={onLogout}
        disabled={offline}
        disabledReason={NEEDS_CONNECTION}
      >
        Log out
      </MenuItem>
    </Menu>
  );
}
