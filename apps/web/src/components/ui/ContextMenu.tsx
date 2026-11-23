import * as Context from "@radix-ui/react-context-menu";
import { ChevronRight, type LucideIcon } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { Icon } from "./Icon.tsx";
// The context menu looks exactly like the "⋯" menus.
import "./Menu.css";
import "./ContextMenu.css";

/**
 * A menu opened by a right-click, or a long press on touch, on `children`. Items are
 * ContextMenuItem, ContextMenuSub and ContextMenuSeparator; the same actions should also be
 * reachable without a right-click, such as from a "⋯" button. `disabled` leaves the right-click
 * to the browser. `open` and `onOpenChange` let the page hold whether the menu is open, and
 * `onCloseAutoFocus` is Radix's, for a menu that must put the focus back somewhere of its own.
 */
export function ContextMenu({
  children,
  items,
  disabled = false,
  open,
  onOpenChange,
  onCloseAutoFocus,
  className,
}: {
  children: ReactElement;
  items: ReactNode;
  disabled?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onCloseAutoFocus?: (event: Event) => void;
  className?: string;
}) {
  return (
    <Context.Root
      {...(open !== undefined ? { open } : {})}
      {...(onOpenChange ? { onOpenChange } : {})}
    >
      <Context.Trigger asChild disabled={disabled}>
        {children}
      </Context.Trigger>
      <Context.Portal>
        <Context.Content
          className={`ui-menu ui-context-menu${className ? ` ${className}` : ""}`}
          collisionPadding={8}
          {...(onCloseAutoFocus ? { onCloseAutoFocus } : {})}
        >
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
  keys,
  danger = false,
  disabled = false,
  disabledReason,
}: {
  children: ReactNode;
  /** Calling `preventDefault` on the event keeps the menu open. */
  onSelect: (event: Event) => void;
  icon?: LucideIcon;
  /** The item's shortcut as people read it, such as "Ctrl+B". */
  keys?: string;
  danger?: boolean;
  disabled?: boolean;
  /** Said beside a disabled item, so the author knows why it cannot be chosen. */
  disabledReason?: string | undefined;
}) {
  return (
    <Context.Item
      className={`ui-menu-item${danger ? " is-danger" : ""}`}
      disabled={disabled}
      onSelect={onSelect}
    >
      {icon && <Icon icon={icon} size="sm" />}
      <span>{children}</span>
      {disabled && disabledReason ? (
        <span className="ui-menu-note">{disabledReason}</span>
      ) : (
        keys && <kbd className="ui-menu-keys">{keys}</kbd>
      )}
    </Context.Item>
  );
}

/** An item that opens a further menu beside it, such as "Style ▸". */
export function ContextMenuSub({
  label,
  icon,
  children,
}: {
  label: string;
  icon?: LucideIcon;
  children: ReactNode;
}) {
  return (
    <Context.Sub>
      <Context.SubTrigger className="ui-menu-item ui-menu-sub">
        {icon && <Icon icon={icon} size="sm" />}
        <span>{label}</span>
        <Icon icon={ChevronRight} size="sm" className="ui-menu-chevron" />
      </Context.SubTrigger>
      <Context.Portal>
        <Context.SubContent className="ui-menu ui-context-menu" sideOffset={2} collisionPadding={8}>
          {children}
        </Context.SubContent>
      </Context.Portal>
    </Context.Sub>
  );
}

export function ContextMenuSeparator() {
  return <Context.Separator className="ui-menu-separator" />;
}
