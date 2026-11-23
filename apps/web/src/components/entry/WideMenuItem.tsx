import { FoldHorizontal, UnfoldHorizontal } from "lucide-react";
import { useWide } from "../../width.ts";
import { MenuItem } from "../ui/Menu.tsx";

/** The full-width switch in a "⋯" menu: the entry's and the editor's. */
export function WideMenuItem() {
  const [wide, setWide] = useWide();
  return (
    <MenuItem icon={wide ? FoldHorizontal : UnfoldHorizontal} onSelect={() => setWide(!wide)}>
      {wide ? "Reading width" : "Full width"}
    </MenuItem>
  );
}
