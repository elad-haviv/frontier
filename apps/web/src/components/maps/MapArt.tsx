import { useState } from "react";
import { imageUrl } from "../../api.ts";
import type { MapRow } from "../../map/mapsList.ts";
import { isDark, KIND_PICTURES } from "./KindPictures.tsx";

const SPACE = "#12141c";

/**
 * A map's picture for its card or row: its own image for a globe or a flat map (a globe's in a
 * circle, shaded like a ball), the stars and routes of a star map seen from above, the orbits of a
 * system model, or, when there is nothing to draw yet, the kind's own small drawing. It is
 * decoration: the title names the map.
 */
export function MapArt({ row }: { row: MapRow }) {
  const p = row.preview;
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  if (p?.kind === "stars" && row.kind === "stars") {
    return (
      <svg
        className="map-art"
        viewBox="0 0 160 120"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
      >
        <rect width="160" height="120" fill={SPACE} />
        {Array.from({ length: 14 }, (_, i) => (
          <rect
            key={i}
            x={(((i * 97 + 13) % 160) + 160) % 160}
            y={(((i * 53 + 7) % 120) + 120) % 120}
            width="1"
            height="1"
            fill="#ebe4d6"
            opacity=".25"
          />
        ))}
        {p.lines.map(([a, b], i) => (
          <line
            key={i}
            x1={p.dots[a]!.x * 160}
            y1={p.dots[a]!.y * 120}
            x2={p.dots[b]!.x * 160}
            y2={p.dots[b]!.y * 120}
            stroke="#e3c58a"
            strokeOpacity=".6"
          />
        ))}
        {p.dots.map((d, i) => (
          <g key={i}>
            <circle cx={d.x * 160} cy={d.y * 120} r="6" fill={d.c} opacity=".18" />
            <circle cx={d.x * 160} cy={d.y * 120} r="2.2" fill={d.c} />
          </g>
        ))}
      </svg>
    );
  }
  if (p?.kind === "system" && row.kind === "system") {
    return (
      <svg
        className="map-art"
        viewBox="0 0 160 120"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
      >
        <rect width="160" height="120" fill={SPACE} />
        {p.rings.map((r, i) => {
          const rx = 18 + r.r * 56;
          return (
            <g key={i}>
              <ellipse
                cx="80"
                cy="60"
                rx={rx}
                ry={rx / 2.1}
                fill="none"
                stroke="#ebe4d6"
                strokeOpacity=".3"
              />
              <circle
                cx={80 + rx * Math.cos(r.a)}
                cy={60 + (rx / 2.1) * Math.sin(r.a)}
                r="3"
                fill={r.c}
              />
            </g>
          );
        })}
        <circle cx="80" cy="60" r="12" fill={p.star} opacity=".2" />
        <circle cx="80" cy="60" r="5" fill={p.star} />
      </svg>
    );
  }
  if (p?.kind === "image" && !failed && (row.kind === "sphere" || row.kind === "flat")) {
    const img = (
      <img
        src={imageUrl(p.path, 320)}
        alt=""
        loading="lazy"
        decoding="async"
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
      />
    );
    return (
      <span className={`map-art image${loaded ? " loaded" : ""}`} aria-hidden="true">
        {row.kind === "sphere" ? <span className="ball">{img}</span> : img}
      </span>
    );
  }
  return (
    <span className={`map-art drawing${isDark(row.kind) ? " dark" : ""}`} aria-hidden="true">
      {KIND_PICTURES[row.kind]}
    </span>
  );
}
