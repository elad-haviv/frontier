import { useId } from "react";
import { artSampleUrl } from "../../api.ts";

/** How each starter style's drawing is coloured and lined. */
interface Look {
  a: string;
  b: string;
  sun: string;
  sea: string;
  land: string;
  tower: string;
  roof: string;
  line: string;
  w: number;
  hatch: 0 | 1 | 2;
  blur?: number;
}

const LOOKS: Record<string, Look> = {
  notebook: {
    a: "#eadcbd",
    b: "#e2d1ab",
    sun: "none",
    sea: "#d9c9a2",
    land: "#cdb98d",
    tower: "#efe4c9",
    roof: "#b79a6a",
    line: "#5a4124",
    w: 0.9,
    hatch: 0,
  },
  water: {
    a: "#f6e6d8",
    b: "#bcd9e6",
    sun: "#f3b07a",
    sea: "#8fbfd0",
    land: "#9db68a",
    tower: "#fbf4ea",
    roof: "#d97a6a",
    line: "none",
    w: 0,
    hatch: 0,
    blur: 0.9,
  },
  woodcut: {
    a: "#f1ead9",
    b: "#f1ead9",
    sun: "#1b1916",
    sea: "#f1ead9",
    land: "#1b1916",
    tower: "#f1ead9",
    roof: "#1b1916",
    line: "#1b1916",
    w: 1.8,
    hatch: 1,
  },
  oil: {
    a: "#2b2a4a",
    b: "#e58a3c",
    sun: "#ffd27a",
    sea: "#1f4a5c",
    land: "#2a2118",
    tower: "#e8d7b8",
    roof: "#7c2a1c",
    line: "none",
    w: 0,
    hatch: 0,
  },
  engrave: {
    a: "#f3efe2",
    b: "#f3efe2",
    sun: "none",
    sea: "#f3efe2",
    land: "#e4dfcf",
    tower: "#f3efe2",
    roof: "#f3efe2",
    line: "#1f4b52",
    w: 0.6,
    hatch: 2,
  },
  gouache: {
    a: "#f2c14e",
    b: "#f78154",
    sun: "#fff3d6",
    sea: "#1d6a73",
    land: "#143642",
    tower: "#fff3d6",
    roof: "#b4432f",
    line: "none",
    w: 0,
    hatch: 0,
  },
};

/**
 * The drawing a starter style ships with: the sample scene (a lighthouse on a cliff) in the
 * style's manner, drawn by the app. It stands in until the person makes a sample with their model.
 */
function StarterScene({ look }: { look: Look }) {
  const id = useId().replace(/:/g, "");
  const stroke =
    look.line === "none"
      ? {}
      : { stroke: look.line, strokeWidth: look.w, strokeLinejoin: "round" as const };
  const hatch: { d: string; w: number }[] = [];
  if (look.hatch) {
    for (let y = 55; y < 80; y += look.hatch === 2 ? 2.2 : 4.5) {
      hatch.push({
        d: `M${58 + ((y * 7) % 9)} ${y}H${118 - ((y * 5) % 14)}`,
        w: look.hatch === 2 ? 0.4 : 1.3,
      });
    }
  }
  if (look.hatch === 2) {
    for (let x = 4; x < 54; x += 3) hatch.push({ d: `M${x} ${50 + (x % 7)}l-3 24`, w: 0.35 });
  }
  return (
    <svg viewBox="0 0 120 80" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}g`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={look.a} />
          <stop offset="1" stopColor={look.b} />
        </linearGradient>
        {look.blur && (
          <filter id={`${id}f`}>
            <feGaussianBlur stdDeviation={look.blur} />
          </filter>
        )}
      </defs>
      <rect width="120" height="80" fill={`url(#${id}g)`} />
      <g filter={look.blur ? `url(#${id}f)` : undefined}>
        <circle cx="90" cy="27" r="9" fill={look.sun} {...stroke} />
        <rect x="-2" y="52" width="124" height="30" fill={look.sea} {...stroke} />
        <path d="M31 14 L120 30 L120 44 Z" fill={look.tower} opacity="0.28" />
        <path d="M-2 82V46Q14 39 26 43L44 47Q53 50 57 61L61 82Z" fill={look.land} {...stroke} />
        <path d="M24 44L27 19H35L38 44Z" fill={look.tower} {...stroke} />
        <path d="M26 32h10l.6 5H25.4Z" fill={look.roof} {...stroke} />
        <rect
          x="26.5"
          y="12.5"
          width="9"
          height="6.5"
          fill={look.sun === "none" ? look.tower : look.sun}
          {...stroke}
        />
        <path d="M25 12.5L31 6L37 12.5Z" fill={look.roof} {...stroke} />
      </g>
      {hatch.map((h) => (
        <path key={h.d} d={h.d} fill="none" stroke={look.line} strokeWidth={h.w} />
      ))}
      <path
        d="M66 20q3-3 6 0q3-3 6 0M76 13q2-2 4 0q2-2 4 0"
        fill="none"
        stroke={look.line === "none" ? look.land : look.line}
        strokeWidth="0.9"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * The sample picture of an art style (stage 34), 3:2: the picture the person made, the drawing a
 * starter style ships with, or a hatched space that says there is none.
 */
export function StyleSample({
  sample,
  none = "No sample yet",
}: {
  sample: string | null;
  none?: string;
}) {
  const look = sample?.startsWith("starter-") ? LOOKS[sample.slice(8)] : undefined;
  if (look) {
    return (
      <span className="style-sample">
        <StarterScene look={look} />
      </span>
    );
  }
  if (sample && !sample.startsWith("starter-")) {
    return (
      <span className="style-sample">
        <img src={artSampleUrl(sample)} alt="" loading="lazy" />
      </span>
    );
  }
  return <span className="style-sample none">{none}</span>;
}
