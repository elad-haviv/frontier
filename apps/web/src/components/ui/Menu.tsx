import * as Dropdown from "@radix-ui/react-dropdown-menu";
import { Ellipsis, type LucideIcon } from "lucide-react";
import { type ReactNode, useRef } from "react";
import { Link } from "react-router-dom";
import { Icon } from "./Icon.tsx";
import { IconButton } from "./IconButton.tsx";
import "./Menu.css";

/**
 * Keeps the focus where an item put it. An item that opens a question box moves the focus into
 * the box; without this the menu, closing a moment later, would take it back to its button.
 */
function keepFocusElsewhere(content: { current: HTMLElement | null }) {
  return (e: Event) => {
    const now = document.activeElement;
    if (now && now !== document.body && !content.current?.contains(now)) e.preventDefault();
  };
}

/**
 * A "⋯" button that opens a menu of actions. `label` names the button for screen readers and
 * in its tooltip ("More actions"). Items are MenuItem, MenuLink and MenuSeparator.
 */
export function Menu({
  label,
  icon = Ellipsis,
  className,
  align = "end",
  children,
}: {
  label: string;
  icon?: LucideIcon;
  className?: string;
  align?: "start" | "center" | "end";
  children: ReactNode;
}) {
  const content = useRef<HTMLDivElement>(null);
  return (
    <Dropdown.Root>
      <Dropdown.Trigger asChild>
        <IconButton label={label} icon={icon} {...(className ? { className } : {})} />
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content
          ref={content}
          className="ui-menu"
          align={align}
          sideOffset={4}
          collisionPadding={8}
          onCloseAutoFocus={keepFocusElsewhere(content)}
        >
          {children}
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}

/** One action in a menu. `danger` marks one that removes something. */
export function MenuItem({
  children,
  onSelect,
  icon,
  danger = false,
  disabled = false,
  disabledReason,
}: {
  children: ReactNode;
  onSelect: () => void;
  icon?: LucideIcon;
  danger?: boolean;
  disabled?: boolean;
  /** Said beside a disabled item, so the author knows why it cannot be chosen. */
  disabledReason?: string | undefined;
}) {
  return (
    <Dropdown.Item
      className={`ui-menu-item${danger ? " is-danger" : ""}`}
      disabled={disabled}
      onSelect={onSelect}
    >
      {icon && <Icon icon={icon} size="sm" />}
      <span>{children}</span>
      {disabled && disabledReason && <span className="ui-menu-note">{disabledReason}</span>}
    </Dropdown.Item>
  );
}

/** A place to go, in a menu. */
export function MenuLink({
  to,
  children,
  icon,
}: {
  to: string;
  children: ReactNode;
  icon?: LucideIcon;
}) {
  return (
    <Dropdown.Item asChild className="ui-menu-item">
      <Link to={to}>
        {icon && <Icon icon={icon} size="sm" />}
        <span>{children}</span>
      </Link>
    </Dropdown.Item>
  );
}

export function MenuSeparator() {
  return <Dropdown.Separator className="ui-menu-separator" />;
}
