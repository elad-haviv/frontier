/**
 * You › AI models › Concept art: the person's library of art styles (stage 34). A card for each
 * style; the one chosen is the usual style, which discoveries are drawn in and the picture dialog
 * starts on. Edit opens the style's dialog; a deleted style can be put back.
 */
import { ART_STYLES_MAX, type ArtStyle, type ArtStylesResponse } from "@frontier/schema";
import { useState } from "react";
import { api } from "../../api.ts";
import { ArtStyleEditor, type ArtStyleEvent } from "../../components/images/ArtStyleEditor.tsx";
import { StyleSample } from "../../components/images/StyleSample.tsx";
import { useToast } from "../../components/ui/Toast.tsx";
import { message, Saved, useAutoSave, useSettingsData } from "./shared.tsx";

export function ArtStyles() {
  const { settings, reload } = useSettingsData();
  const toast = useToast();
  const saving = useAutoSave();
  const [editing, setEditing] = useState<ArtStyle | "new" | null>(null);
  if (!settings) return null;
  const library: ArtStylesResponse = {
    styles: settings.ai.artStyles,
    usual: settings.ai.usualArtStyle,
  };
  const { styles, usual } = library;

  async function makeUsual(id: string) {
    if (id === usual) return;
    if (await saving.run(() => api.saveAi({ usualArtStyle: id }))) await reload();
  }

  /** Runs a change that is not one control's, and says so when it fails. */
  async function quietly(work: () => Promise<string | null>) {
    try {
      const said = await work();
      await reload();
      if (said) toast({ message: said });
    } catch (err) {
      toast({ message: message(err) });
    }
  }

  function changed(_: ArtStylesResponse, event: ArtStyleEvent) {
    void reload();
    if (event.kind === "duplicated") {
      // The editor goes on with the copy.
      setEditing(event.style);
      toast({ message: `Duplicated. This is ${event.style.name}.` });
      return;
    }
    setEditing(null);
    if (event.kind !== "deleted") return;
    const { style, at, wasUsual } = event;
    toast({
      message: `Deleted ${style.name}.`,
      action: {
        label: "Undo",
        run: () =>
          void quietly(
            async () => (await api.addArtStyle({ ...style, at, usual: wasUsual }), null),
          ),
      },
    });
  }

  function onKey(e: React.KeyboardEvent<HTMLDivElement>) {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    const from = (e.target as HTMLElement).closest<HTMLElement>("[role=radio]");
    if (!step || !from) return;
    e.preventDefault();
    const all = [...e.currentTarget.querySelectorAll<HTMLElement>("[role=radio]")];
    const next = all[(all.indexOf(from) + step + all.length) % all.length];
    if (!next) return;
    next.focus();
    void makeUsual(next.dataset.style!);
  }

  return (
    <div className="task-styles">
      <div className="art-styles-head">
        <h4 id="art-styles-title">
          Your art styles <Saved at={saving.savedAt} />
        </h4>
        <span className="muted small">
          The usual one is used unless you pick another when making a picture.
        </span>
      </div>
      <div
        className="art-style-grid"
        role="radiogroup"
        aria-labelledby="art-styles-title"
        onKeyDown={onKey}
      >
        {styles.map((s) => (
          <div key={s.id} className={`art-style-card${s.id === usual ? " is-usual" : ""}`}>
            <button
              type="button"
              className="art-style-pick"
              role="radio"
              aria-checked={s.id === usual}
              tabIndex={s.id === usual ? 0 : -1}
              data-style={s.id}
              title={s.id === usual ? "The usual style" : "Make this the usual style"}
              onClick={() => void makeUsual(s.id)}
            >
              <span className="art-style-picture">
                <StyleSample sample={s.sample} />
                <i className="art-style-dot" aria-hidden="true" />
              </span>
              <span className="art-style-name">{s.name}</span>
              <span className="art-style-text">{s.text}</span>
            </button>
            <div className="art-style-foot">
              {s.id === usual ? <span className="art-style-usual">Usual</span> : <span />}
              <button
                type="button"
                className="plain"
                aria-label={`Edit ${s.name}`}
                onClick={() => setEditing(s)}
              >
                Edit
              </button>
            </div>
          </div>
        ))}
        {styles.length < ART_STYLES_MAX && (
          <button type="button" className="art-style-new" onClick={() => setEditing("new")}>
            <span aria-hidden="true">+</span>
            New style
          </button>
        )}
      </div>
      {saving.error && <p className="field-error">{saving.error}</p>}
      <p className="art-styles-note muted small">
        <span>
          {styles.length} of {ART_STYLES_MAX} styles. They follow you to every device and project.
        </span>
        <button
          type="button"
          className="plain"
          onClick={() =>
            void quietly(async () => {
              const { added } = await api.starterArtStyles();
              return added
                ? `Added ${added} starter ${added === 1 ? "style" : "styles"}.`
                : "All the starter styles are already here.";
            })
          }
        >
          Bring back the starter styles
        </button>
      </p>
      {editing && (
        <ArtStyleEditor
          key={editing === "new" ? "new" : editing.id}
          style={editing === "new" ? null : editing}
          library={library}
          onChanged={changed}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
