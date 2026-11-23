import { Activity, Download, History, Keyboard, LogOut, Settings, Upload } from "lucide-react";
import { Menu, MenuItem, MenuLink, MenuSeparator } from "../ui/Menu.tsx";

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
  return (
    <Menu label="App menu" className="app-menu" align={align}>
      <MenuLink icon={Upload} to="/import">
        Import
      </MenuLink>
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
      <MenuItem icon={LogOut} onSelect={onLogout}>
        Log out
      </MenuItem>
    </Menu>
  );
}
