import * as Context from "@radix-ui/react-context-menu";
import type { LucideIcon } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { Icon } from "./Icon.tsx";
// The context menu looks exactly like the "⋯" menus.
import "./Menu.css";
import "./ContextMenu.css";

/**
 * A menu opened by a right-click, or a long press on touch, on `children`. Items are
 * ContextMenuItem and ContextMenuSeparator; the same actions should also be reachable without
 * a right-click, such as from a "⋯" button.
 */
export function ContextMenu({ children, items }: { children: ReactElement; items: ReactNode }) {
  return (
    <Context.Root>
      <Context.Trigger asChild>{children}</Context.Trigger>
      <Context.Portal>
        <Context.Content className="ui-menu ui-context-menu" collisionPadding={8}>
          {items}
        </Context.Content>
      </Context.Portal>
    </Context.Root>
  );
}

export function ContextMenuItem({
  children,
  onSelect,
  icon,
  danger = false,
  disabled = false,
}: {
  children: ReactNode;
  onSelect: () => void;
  icon?: LucideIcon;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <Context.Item
      className={`ui-menu-item${danger ? " is-danger" : ""}`}
      disabled={disabled}
      onSelect={onSelect}
    >
      {icon && <Icon icon={icon} size="sm" />}
      <span>{children}</span>
    </Context.Item>
  );
}

export function ContextMenuSeparator() {
  return <Context.Separator className="ui-menu-separator" />;
}
