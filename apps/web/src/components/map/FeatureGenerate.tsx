import type { MapFeature } from "@frontier/schema";
import { Sparkles } from "lucide-react";
import { useState } from "react";
import { api, ApiFailure, type GeneratedFeature } from "../../api.ts";
import { choiceName, middleOf } from "../../map/place.ts";
import { Icon } from "../ui/Icon.tsx";

/**
 * Generate, in the Edit feature tab: a name and a short description for the selected feature,
 * from what is around it and the lore, at random or as described. It is a preview until it is
 * used; once used, its entry can be made with the description.
 */
export function FeatureGenerate({
  mapId,
  feature,
  choices,
  moment,
  onUse,
  onMakeEntry,
}: {
  mapId: string;
  feature: MapFeature;
  /** The looks it may take, offered to the model. */
  choices: { id: string; name: string }[];
  moment: { chronicle: string | null; year: number | null };
  onUse: (proposal: GeneratedFeature) => void;
  /** Makes an entry for the feature with the description, or null when it has one. */
  onMakeEntry: ((name: string, description: string) => void) | null;
}) {
  const [describing, setDescribing] = useState(false);
  const [wish, setWish] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [proposal, setProposal] = useState<GeneratedFeature | null>(null);
  const [used, setUsed] = useState<GeneratedFeature | null>(null);

  function ask(prompt: string | null) {
    setBusy(true);
    setProblem(null);
    setUsed(null);
    api
      .generateFeatures(mapId, {
        kind: feature.kind as Exclude<MapFeature["kind"], "route">,
        at: middleOf(feature),
        count: 1,
        prompt,
        exclude: feature.id,
        choices,
        ...moment,
      })
      .then(
        (r) => {
          setProposal(r.items[0] ?? null);
          if (!r.items[0]) setProblem("Nothing was proposed. Try again.");
          setDescribing(false);
        },
        (err: unknown) =>
          setProblem(err instanceof ApiFailure ? err.message : "Nothing could be proposed."),
      )
      .finally(() => setBusy(false));
  }

  const look = proposal ? choiceName(proposal.choice, choices) : null;
  return (
    <section className="field feature-generate" aria-label="Generate">
      <span>
        <Icon icon={Sparkles} size="sm" /> Generate{" "}
        <em className="muted">a name and description</em>
      </span>
      {!proposal && !describing && (
        <span className="order-buttons">
          <button type="button" className="quiet" disabled={busy} onClick={() => ask(null)}>
            Surprise me
          </button>
          <button
            type="button"
            className="quiet"
            disabled={busy}
            onClick={() => setDescribing(true)}
          >
            Describe it…
          </button>
        </span>
      )}
      {describing && !proposal && (
        <form
          className="feature-generate-ask"
          onSubmit={(e) => {
            e.preventDefault();
            if (wish.trim()) ask(wish.trim());
          }}
        >
          <input
            type="text"
            aria-label="What it should be"
            placeholder="A ruined watchtower held by smugglers"
            value={wish}
            maxLength={500}
            onChange={(e) => setWish(e.target.value)}
          />
          <span className="order-buttons">
            <button type="submit" className="primary" disabled={busy || !wish.trim()}>
              Propose
            </button>
            <button type="button" className="quiet" onClick={() => setDescribing(false)}>
              Cancel
            </button>
          </span>
        </form>
      )}
      {busy && (
        <p className="muted" role="status">
          Thinking of something that fits…
        </p>
      )}
      {problem && (
        <p className="error" role="alert">
          {problem}
        </p>
      )}
      {proposal && (
        <div className="generate-preview" aria-label="Proposed">
          <strong>{proposal.name}</strong>
          {look && <em className="muted"> · {look}</em>}
          <p>{proposal.description}</p>
          {proposal.basis.length > 0 && (
            <p className="muted generate-basis">
              Grown from{" "}
              {[...new Set(proposal.basis.map((b) => b.path.split("/").pop()))]
                .map((p) => p?.replace(/\.md$/, ""))
                .join(", ")}
              .
            </p>
          )}
          <span className="order-buttons">
            <button
              type="button"
              className="primary"
              onClick={() => {
                onUse(proposal);
                setUsed(proposal);
                setProposal(null);
              }}
            >
              Use this
            </button>
            <button type="button" className="quiet" onClick={() => setProposal(null)}>
              Discard
            </button>
          </span>
        </div>
      )}
      {used && onMakeEntry && (
        <p className="generate-entry">
          <button
            type="button"
            className="quiet"
            onClick={() => {
              onMakeEntry(used.name, used.description);
              setUsed(null);
            }}
          >
            Make an entry for “{used.name}”…
          </button>
        </p>
      )}
    </section>
  );
}
