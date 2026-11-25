import type { ReactNode } from "react";
import type { Kind } from "../../map/mapsList.ts";

const STROKE = "var(--ink-soft)";

/** The small drawing of each kind of map: on the New map cards, and where a map has no picture. */
export const KIND_PICTURES: Record<Kind, ReactNode> = {
  sphere: (
    <svg viewBox="0 0 80 50" width="80" height="50" aria-hidden="true">
      <circle cx="40" cy="25" r="18" fill="none" stroke={STROKE} strokeWidth="1.5" />
      <ellipse cx="40" cy="25" rx="8" ry="18" fill="none" stroke={STROKE} />
      <path d="M22 25h36" fill="none" stroke={STROKE} />
    </svg>
  ),
  flat: (
    <svg viewBox="0 0 80 50" width="80" height="50" aria-hidden="true">
      <path
        d="M14 12l17-4 18 5 17-4v29l-17 4-18-5-17 4z"
        fill="none"
        stroke={STROKE}
        strokeWidth="1.5"
      />
      <path d="M31 8v29M49 13v29" fill="none" stroke={STROKE} />
    </svg>
  ),
  stars: (
    <svg viewBox="0 0 80 50" width="80" height="50" aria-hidden="true">
      <path d="M8 40l22-12h42M20 46l22-18M52 46l-4-18" stroke="#3a3f4e" fill="none" />
      <path d="M22 18l20 6 18-12" stroke="#e3c58a" fill="none" strokeWidth="1.3" />
      <circle cx="22" cy="18" r="3" fill="#f2d28a" />
      <circle cx="42" cy="24" r="2.4" fill="#d9694a" />
      <circle cx="60" cy="12" r="3.4" fill="#dfe6ee" />
      <path d="M22 18v14M60 12v18" stroke="#ebe4d6" strokeOpacity=".35" fill="none" />
    </svg>
  ),
  system: (
    <svg viewBox="0 0 80 50" width="80" height="50" aria-hidden="true">
      <ellipse cx="40" cy="25" rx="14" ry="7" fill="none" stroke="#ebe4d6" strokeOpacity=".3" />
      <ellipse cx="40" cy="25" rx="30" ry="15" fill="none" stroke="#ebe4d6" strokeOpacity=".3" />
      <circle cx="40" cy="25" r="5" fill="#f2d28a" />
      <circle cx="53" cy="28" r="2.2" fill="#6d9fcf" />
      <circle cx="14" cy="18" r="3.5" fill="#d9b38c" />
    </svg>
  ),
};

/** The kinds that are drawn on dark, as their canvases are, in both themes. */
export const isDark = (kind: Kind) => kind === "stars" || kind === "system";
