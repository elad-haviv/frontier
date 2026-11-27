import { ART_STYLES_MAX, type ArtStyle, type ArtStylesResponse } from "@frontier/schema";
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api, ApiFailure } from "../../api.ts";
import { DialogFrame } from "../Dialogs.tsx";
import { ActionButton } from "../ui/ActionButton.tsx";
import { StyleSample } from "./StyleSample.tsx";
import "./ArtStyles.css";

/** What the editor did, told with the library as it then is. */
export type ArtStyleEvent =
  | { kind: "saved" | "added" | "duplicated"; style: ArtStyle }
  /** Where the deleted style was, and whether it was the usual one: what Undo needs. */
  | { kind: "deleted"; style: ArtStyle; at: number; wasUsual: boolean };

const problemOf = (err: unknown, otherwise: string) =>
  err instanceof ApiFailure ? err.message : otherwise;

/** A name not yet in the library: "Woodcut print copy", then "… copy 2". */
function copyName(name: string, taken: readonly string[]): string {
  const has = (n: string) => taken.some((t) => t.toLowerCase() === n.toLowerCase());
  const base = `${name.slice(0, 32)} copy`;
  let next = base;
  for (let i = 2; has(next); i++) next = `${base} ${i}`;
  return next;
}

/**
 * The dialog that makes or changes one art style (stage 34): its name, what its pictures look
 * like, and a sample. It opens from the settings and from the picture dialog, over which it is
 * shown: it is put at the end of the page, so it is not a form inside that dialog's form.
 */
export function ArtStyleEditor({
  style,
  start,
  library,
  onChanged,
  onClose,
}: {
  /** The style being changed, or null for a new one. */
  style: ArtStyle | null;
  /** What a new style starts as: words written for one picture. */
  start?: { text: string };
  library: ArtStylesResponse;
  onChanged: (library: ArtStylesResponse, event: ArtStyleEvent) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(style?.name ?? "");
  const [text, setText] = useState(style?.text ?? start?.text.slice(0, 600) ?? "");
  const [sample, setSample] = useState(style?.sample ?? null);
  const [busy, setBusy] = useState<"sample" | "saving" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const nameBox = useRef<HTMLInputElement>(null);
  const textBox = useRef<HTMLTextAreaElement>(null);

  /** The fields as they would be saved, or null with the reason shown. */
  function checked(): { name: string; text: string } | null {
    const n = name.trim();
    const t = text.trim();
    if (!n) {
      setProblem("Give the style a name.");
      nameBox.current?.focus();
      return null;
    }
    if (!t) {
      setProblem("Say how its pictures look.");
      textBox.current?.focus();
      return null;
    }
    return { name: n, text: t };
  }

  async function run(kind: "sample" | "saving", work: () => Promise<void>, otherwise: string) {
    if (busy) return;
    setBusy(kind);
    setProblem(null);
    try {
      await work();
    } catch (err) {
      setProblem(problemOf(err, otherwise));
    } finally {
      setBusy(null);
    }
  }

  const save = () => {
    const fields = checked();
    if (!fields) return;
    void run(
      "saving",
      async () => {
        if (style) {
          const next = await api.editArtStyle(style.id, { ...fields, sample });
          onChanged(next, { kind: "saved", style: next.styles.find((s) => s.id === style.id)! });
        } else {
          const next = await api.addArtStyle({ ...fields, sample });
          const made = next.styles.find((s) => !library.styles.some((x) => x.id === s.id));
          onChanged(next, { kind: "added", style: made ?? next.styles.at(-1)! });
        }
      },
      "The style was not saved.",
    );
  };

  const duplicate = () => {
    if (!style) return;
    void run(
      "saving",
      async () => {
        const at = library.styles.findIndex((s) => s.id === style.id) + 1;
        const next = await api.addArtStyle({
          name: copyName(
            name.trim() || style.name,
            library.styles.map((s) => s.name),
          ),
          text: text.trim() || style.text,
          sample,
          at,
        });
        onChanged(next, { kind: "duplicated", style: next.styles[at]! });
      },
      "The style was not duplicated.",
    );
  };

  const remove = () => {
    if (!style) return;
    void run(
      "saving",
      async () => {
        const at = library.styles.findIndex((s) => s.id === style.id);
        const next = await api.removeArtStyle(style.id);
        onChanged(next, { kind: "deleted", style, at, wasUsual: library.usual === style.id });
      },
      "The style was not deleted.",
    );
  };

  const drawSample = () => {
    const t = text.trim();
    if (!t) {
      setProblem("Say how its pictures look, then make a sample.");
      textBox.current?.focus();
      return;
    }
    void run(
      "sample",
      async () => setSample((await api.artSample(t)).sample),
      "No picture came back.",
    );
  };

  return createPortal(
    // The picture dialog's form is this one's parent in React: its Insert must not hear this Save.
    <div onSubmit={(e) => e.stopPropagation()}>
      <DialogFrame
        title={style ? "Edit style" : "New style"}
        className="art-style-editor"
        initialFocus={nameBox}
        onCancel={onClose}
        onSubmit={save}
      >
        <label className="dialog-field">
          <span>Name</span>
          <input
            ref={nameBox}
            value={name}
            maxLength={40}
            placeholder="Such as Charcoal study"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="dialog-field">
          <span>How its pictures look</span>
          <textarea
            ref={textBox}
            value={text}
            rows={4}
            maxLength={600}
            onChange={(e) => setText(e.target.value)}
          />
          <em className="muted small">
            {text.length} of 600 characters. Put before the description of each picture.
          </em>
        </label>
        <div className="art-style-sample">
          <span className="art-style-sample-picture" aria-busy={busy === "sample"}>
            <StyleSample sample={sample} />
            {busy === "sample" && (
              <span className="art-style-drawing" role="status">
                Drawing…
              </span>
            )}
          </span>
          <div>
            <ActionButton className="quiet" disabled={busy !== null} onClick={drawSample}>
              {sample && !sample.startsWith("starter-") ? "Make it again" : "Make a sample"}
            </ActionButton>
            <p className="muted small">
              {sample?.startsWith("starter-")
                ? "This drawing came with the style. A sample is made by your picture model and costs what a picture does."
                : "A sample costs what a picture does, paid to your provider."}{" "}
              Every sample is the same scene, a lighthouse on a cliff, so styles compare.
            </p>
          </div>
        </div>
        {problem && (
          <p className="field-error" role="alert">
            {problem}
          </p>
        )}
        <p className="dialog-actions art-style-actions">
          {style && (
            <>
              <button
                type="button"
                className="plain danger"
                disabled={busy !== null || library.styles.length < 2}
                title={library.styles.length < 2 ? "The last style stays" : undefined}
                onClick={remove}
              >
                Delete
              </button>
              <button
                type="button"
                className="plain"
                disabled={busy !== null || library.styles.length >= ART_STYLES_MAX}
                onClick={duplicate}
              >
                Duplicate
              </button>
            </>
          )}
          <button type="button" className="quiet" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={busy !== null}>
            {style ? "Save" : "Add style"}
          </button>
        </p>
      </DialogFrame>
    </div>,
    document.body,
  );
}
