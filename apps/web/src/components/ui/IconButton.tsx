import type { LucideIcon } from "lucide-react";
import type { ButtonHTMLAttributes, MouseEvent, Ref } from "react";
import { Link, type LinkProps } from "react-router-dom";
import { shortcutText } from "../../keys.ts";
import { Icon, type IconSize } from "./Icon.tsx";
import { Tip } from "./Tip.tsx";
import "./IconButton.css";

interface Common {
  /** What the control does. Required: it is the accessible name and the tooltip. */
  label: string;
  icon: LucideIcon;
  /** The id of a shortcut in the keys registry; its keys are shown in the tooltip. */
  shortcut?: string;
  size?: IconSize;
  /** Shows the label beside the icon as well, where there is room for it. */
  showLabel?: boolean;
  tipSide?: "top" | "bottom" | "left" | "right";
}

type ButtonProps = Common &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "children"> & {
    /** Said in the tooltip while the button is disabled, so the author knows what to do. */
    disabledReason?: string;
    ref?: Ref<HTMLButtonElement>;
  };

/**
 * A button drawn as an icon. Its label is its accessible name and its tooltip, with the shortcut
 * from the keys registry. A disabled button stays focusable and says why in its tooltip, so
 * keyboard and screen-reader users can find out too; it simply does nothing when pressed.
 */
export function IconButton({
  label,
  icon,
  shortcut,
  size = "md",
  showLabel = false,
  tipSide,
  disabled = false,
  disabledReason,
  className,
  onClick,
  type = "button",
  ref,
  ...rest
}: ButtonProps) {
  const click = (e: MouseEvent<HTMLButtonElement>) => {
    if (disabled) {
      e.preventDefault();
      return;
    }
    onClick?.(e);
  };
  return (
    <Tip
      label={label}
      keys={shortcutText(shortcut)}
      {...(disabled && disabledReason ? { note: disabledReason } : {})}
      {...(tipSide ? { side: tipSide } : {})}
    >
      <button
        {...rest}
        ref={ref}
        type={type}
        aria-label={label}
        aria-disabled={disabled || undefined}
        className={`ui-icon-button${showLabel ? " has-label" : ""}${className ? ` ${className}` : ""}`}
        onClick={click}
      >
        <Icon icon={icon} size={size} />
        {showLabel && (
          <span className="ui-icon-button-label" aria-hidden="true">
            {label}
          </span>
        )}
      </button>
    </Tip>
  );
}

/** A link drawn as an icon, with the same label, tooltip and accessible name as IconButton. */
export function IconLink({
  label,
  icon,
  shortcut,
  size = "md",
  showLabel = false,
  tipSide,
  className,
  ...rest
}: Common & Omit<LinkProps, "aria-label" | "children">) {
  return (
    <Tip label={label} keys={shortcutText(shortcut)} {...(tipSide ? { side: tipSide } : {})}>
      <Link
        {...rest}
        aria-label={label}
        className={`ui-icon-button${showLabel ? " has-label" : ""}${className ? ` ${className}` : ""}`}
      >
        <Icon icon={icon} size={size} />
        {showLabel && (
          <span className="ui-icon-button-label" aria-hidden="true">
            {label}
          </span>
        )}
      </Link>
    </Tip>
  );
}
