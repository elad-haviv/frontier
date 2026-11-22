import type { LucideIcon } from "lucide-react";
import "./Icon.css";

export type IconSize = "sm" | "md" | "lg";

/**
 * One lucide icon, drawn at one of the app's three icon sizes. Icons are pictures of words said
 * elsewhere (a label, a tooltip), so screen readers skip them.
 */
export function Icon({
  icon: Glyph,
  size = "md",
  className,
}: {
  icon: LucideIcon;
  size?: IconSize;
  className?: string;
}) {
  return (
    <Glyph
      className={`ui-icon ui-icon-${size}${className ? ` ${className}` : ""}`}
      aria-hidden="true"
      focusable="false"
      strokeWidth={1.75}
    />
  );
}
