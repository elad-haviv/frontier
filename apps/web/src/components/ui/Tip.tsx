import * as Tooltip from "@radix-ui/react-tooltip";
import type { ReactElement, ReactNode } from "react";
import { passOn } from "../../keys.ts";
import "./Tip.css";

/**
 * Holds the tooltips' shared timing: once one has shown, the next shows at once as the pointer
 * moves along a toolbar. Tooltips close as soon as the pointer leaves their control, so they never
 * cover the next thing it moves to.
 */
export function TipProvider({ children }: { children: ReactNode }) {
  return (
    <Tooltip.Provider delayDuration={450} skipDelayDuration={300} disableHoverableContent>
      {children}
    </Tooltip.Provider>
  );
}

/**
 * A styled tooltip for one control, shown on hover and on keyboard focus. `keys` is the control's
 * shortcut as people read it; `note` is a second line, such as why the control is disabled.
 */
export function Tip({
  label,
  keys,
  note,
  side = "top",
  children,
}: {
  label: ReactNode;
  keys?: string;
  note?: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  children: ReactElement;
}) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          className="ui-tip"
          side={side}
          sideOffset={6}
          collisionPadding={8}
          // Escape closes the tooltip and still does what it does on the page.
          onEscapeKeyDown={(e) => passOn(e)}
        >
          <span className="ui-tip-label">{label}</span>
          {keys && <kbd className="ui-tip-keys">{keys}</kbd>}
          {note && <span className="ui-tip-note">{note}</span>}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
