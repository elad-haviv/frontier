import * as Dropdown from "@radix-ui/react-dropdown-menu";
import { ChevronDown, Ellipsis, type LucideIcon } from "lucide-react";
import { type ReactNode, useRef } from "react";
import { Link } from "../../nav.tsx";
import { Icon } from "./Icon.tsx";
import { IconButton } from "./IconButton.tsx";
import { Tip } from "./Tip.tsx";
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
 *
 * With `text`, the button shows words beside the icon and a down arrow, such as a style picker
 * showing "Heading 2". `portal: false` draws the menu inside the page beside its button, so CSS
 * around the button (a container query) reaches its items. `onClosed` runs when the menu closes
 * and nothing else has taken the focus, in place of giving it back to the button.
 */
export function Menu({
  label,
  icon = Ellipsis,
  text,
  className,
  contentClassName,
  align = "end",
  side,
  portal = true,
  onPointerDown,
  onClosed,
  trigger,
  children,
}: {
  label: string;
  icon?: LucideIcon;
  text?: string;
  className?: string;
  contentClassName?: string;
  align?: "start" | "center" | "end";
  side?: "top" | "bottom";
  portal?: boolean;
  onPointerDown?: (e: React.PointerEvent) => void;
  onClosed?: () => void;
  /**
   * A button of the caller's own, in place of the "⋯" or the text trigger, such as the project
   * switcher's. It must be a single element that takes a ref and props, like a `<button>`.
   */
  trigger?: ReactNode;
  children: ReactNode;
}) {
  const content = useRef<HTMLDivElement>(null);
  const keep = keepFocusElsewhere(content);
  const menu = (
    <Dropdown.Content
      ref={content}
      className={`ui-menu${contentClassName ? ` ${contentClassName}` : ""}`}
      align={align}
      {...(side ? { side } : {})}
      sideOffset={4}
      collisionPadding={8}
      onCloseAutoFocus={(e) => {
        keep(e);
        if (onClosed && !e.defaultPrevented) {
          e.preventDefault();
          onClosed();
        }
      }}
    >
      {children}
    </Dropdown.Content>
  );
  return (
    <Dropdown.Root>
      <Dropdown.Trigger asChild>
        {trigger ? (
          trigger
        ) : text === undefined ? (
          <IconButton
            label={label}
            icon={icon}
            {...(className ? { className } : {})}
            {...(onPointerDown ? { onPointerDown } : {})}
          />
        ) : (
          <TextTrigger
            label={label}
            icon={icon}
            text={text}
            className={className}
            onPointerDown={onPointerDown}
          />
        )}
      </Dropdown.Trigger>
      {portal ? <Dropdown.Portal>{menu}</Dropdown.Portal> : menu}
    </Dropdown.Root>
  );
}

/** A menu's button that shows words: an icon, the words, and a down arrow. */
function TextTrigger({
  label,
  icon,
  text,
  className,
  ref,
  ...rest
}: {
  label: string;
  icon: LucideIcon;
  text: string;
  className?: string | undefined;
  onPointerDown?: ((e: React.PointerEvent) => void) | undefined;
  ref?: React.Ref<HTMLButtonElement>;
}) {
  return (
    <Tip label={label}>
      <button
        {...rest}
        ref={ref}
        type="button"
        aria-label={label}
        className={`ui-menu-trigger${className ? ` ${className}` : ""}`}
      >
        <Icon icon={icon} size="sm" />
        <span className="ui-menu-trigger-text">{text}</span>
        <Icon icon={ChevronDown} size="sm" className="ui-menu-chevron" />
      </button>
    </Tip>
  );
}

/** One action in a menu. `danger` marks one that removes something. */
export function MenuItem({
  children,
  onSelect,
  icon,
  keys,
  danger = false,
  disabled = false,
  disabledReason,
  checked,
  textValue,
}: {
  children: ReactNode;
  onSelect: () => void;
  icon?: LucideIcon;
  /** The item's shortcut as people read it, such as "Ctrl+B". */
  keys?: string;
  danger?: boolean;
  disabled?: boolean;
  /** Said beside a disabled item, so the author knows why it cannot be chosen. */
  disabledReason?: string | undefined;
  /** Marks the item that is the current choice, as in a style picker. */
  checked?: boolean;
  /** What typing a letter matches, when the item's own words are more than its name. */
  textValue?: string;
}) {
  return (
    <Dropdown.Item
      className={`ui-menu-item${danger ? " is-danger" : ""}`}
      disabled={disabled}
      onSelect={onSelect}
      {...(textValue !== undefined ? { textValue } : {})}
      {...(checked !== undefined ? { "aria-current": checked || undefined } : {})}
    >
      {icon && <Icon icon={icon} size="sm" />}
      <span>{children}</span>
      {disabled && disabledReason ? (
        <span className="ui-menu-note">{disabledReason}</span>
      ) : (
        keys && <kbd className="ui-menu-keys">{keys}</kbd>
      )}
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

/** Words at the top of a menu that are not an action, such as who is logged in. */
export function MenuHeading({ children }: { children: ReactNode }) {
  return <Dropdown.Label className="ui-menu-heading">{children}</Dropdown.Label>;
}

export function MenuSeparator() {
  return <Dropdown.Separator className="ui-menu-separator" />;
}
