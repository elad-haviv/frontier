import { biomeById, type MapFeature } from "@frontier/schema";
import { useEffect, useState } from "react";
import { Link } from "../../nav.tsx";
import { api, ApiFailure, entryUrl, mapUrl } from "../../api.ts";
import { NEEDS_CONNECTION } from "../../sync/connection.ts";
import type { Names } from "../../map/useMapFile.ts";
import { useBiomes } from "../../map/useBiomes.ts";
import { biomeMeaning } from "./BiomeFields.tsx";

/** What a tap on a feature shows while reading: its name, the start of its entry, where it leads. */
export function FeatureCard({
  feature,
  title,
  names,
  children,
  reason,
  carry,
  onCopyLink,
  onEdit,
  onClose,
}: {
  feature: MapFeature;
  title: string;
  names: Names;
  children: Record<string, string>;
  /** Why it is faded or dashed at the year shown, when the map is seen in time. */
  reason?: string | null;
  /** The year and chronicle, carried into the map of this place. */
  carry?: string;
  /** Copies a link that opens the map centred on this feature. */
  onCopyLink: () => void;
  /** Starts editing the map with this feature selected. */
  onEdit: () => void;
  onClose: () => void;
}) {
  const entry = feature.entry ? names[feature.entry] : undefined;
  const { custom } = useBiomes();
  const biome = feature.kind === "zone" ? biomeById(feature.biome, custom) : null;
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    setText(null);
    if (!entry) return;
    let live = true;
    api.preview(entry.path).then(
      (p) => live && setText(p.text.replace(/^#.*\n+/, "").slice(0, 320)),
      // The entry's opening comes from the server; offline the card says so.
      (err: unknown) =>
        live && err instanceof ApiFailure && err.status === 0 && setText(NEEDS_CONNECTION),
    );
    return () => {
      live = false;
    };
  }, [entry?.path]);

  return (
    <aside className="feature-card" aria-label="Selected place">
      <button type="button" className="plain card-close" aria-label="Close" onClick={onClose}>
        ✕
      </button>
      <h2>{title || "Unnamed"}</h2>
      {reason && <p className="card-reason muted">{reason}</p>}
      {biome && (
        <p className="card-biome">
          <strong>{biome.name}</strong> <span className="muted">{biomeMeaning(biome)}</span>
        </p>
      )}
      {text && <p className="card-text">{text}</p>}
      {feature.entry && !entry && <p className="muted">Its entry could not be found.</p>}
      <p className="change-actions">
        {entry && <Link to={entryUrl(entry.path)}>Open the entry</Link>}
        {feature.child &&
          (children[feature.child] ? (
            <Link to={mapUrl(feature.child) + (carry ? `?${carry}` : "")}>
              Open the map of this place
            </Link>
          ) : (
            <span className="muted">Its map is missing.</span>
          ))}
      </p>
      <p className="change-actions card-tools">
        <button type="button" className="quiet" onClick={onCopyLink}>
          Copy a link to this place
        </button>
        <button type="button" className="quiet" onClick={onEdit}>
          Edit this feature
        </button>
      </p>
    </aside>
  );
}
