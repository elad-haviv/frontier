import { type MapStyle, PLAIN_LOOK, STARTER_STYLES } from "@frontier/schema";
import { Pencil, Plus, TextCursorInput, Trash2 } from "lucide-react";
import { useState } from "react";
import { freshName, stylesFor } from "../../map/mapStyles.ts";
import { useMapStyles } from "../../map/useMapStyles.ts";
import { newItemId } from "../../map/viewUrl.ts";
import { useDialogs } from "../Dialogs.tsx";
import { Icon } from "../ui/Icon.tsx";
import { Menu, MenuItem } from "../ui/Menu.tsx";
import { useToast } from "../ui/Toast.tsx";
import { nameProblem, StyleForm } from "./StyleForm.tsx";
import { StyleSample } from "./StyleSample.tsx";
import "./StylesPanel.css";

/** A new style of a kind, in the plain look and its layer's colour. */
function newStyle(styles: MapStyle[], kind: MapStyle["for"]): MapStyle {
  const plain = PLAIN_LOOK[kind];
  return {
    id: newItemId(),
    name: freshName(styles, kind),
    for: kind,
    color: null,
    width: plain.width,
    dash: plain.dash,
    ...(kind === "zone" ? { fill: PLAIN_LOOK.zone.fill } : {}),
  };
}

/**
 * The Styles tab, while editing a map: the library's path styles, then its zone styles, each with
 * a sample, its name and a "⋯" to edit, rename or delete it. Every change goes into the save queue
 * at once, so every open map shows it. There is no undo of its own: a change is taken back by
 * changing it again, a delete by the toast's Undo.
 */
export function StylesPanel({
  open: openGiven,
  onOpen,
}: {
  /** The style whose form is open, as the page keeps it. */
  open?: string | null;
  onOpen?: (id: string | null) => void;
}) {
  const { styles, ready, error, change } = useMapStyles();
  const toast = useToast();
  const dialogs = useDialogs();
  const [openHere, setOpenHere] = useState<string | null>(null);
  const open = openGiven === undefined ? openHere : openGiven;
  const setOpen = (id: string | null) => {
    setOpenHere(id);
    onOpen?.(id);
  };
  const [problem, setProblem] = useState<string | null>(null);

  const replace = (next: MapStyle) =>
    void change((f) => ({ ...f, styles: f.styles.map((s) => (s.id === next.id ? next : s)) }));

  const add = (kind: MapStyle["for"]) => {
    const made = newStyle(styles, kind);
    void change((f) => ({ ...f, styles: [...f.styles, made] }));
    setOpen(made.id);
  };

  const remove = (style: MapStyle) => {
    const at = styles.findIndex((s) => s.id === style.id);
    void change((f) => ({ ...f, styles: f.styles.filter((s) => s.id !== style.id) }));
    if (open === style.id) setOpen(null);
    toast({
      message: `Deleted the style ${style.name}`,
      action: {
        label: "Undo",
        // Back where it was, as it was, unless it has come back some other way.
        run: () =>
          void change((f) => {
            if (f.styles.some((s) => s.id === style.id)) return f;
            const list = [...f.styles];
            list.splice(Math.min(at, list.length), 0, style);
            return { ...f, styles: list };
          }),
      },
    });
  };

  const rename = async (style: MapStyle) => {
    const name = await dialogs.prompt({
      title: `Rename ${style.name}`,
      label: "Name",
      initial: style.name,
      action: "Rename",
    });
    if (name === null || name === style.name) return;
    const wrong = nameProblem(styles, style, name);
    setProblem(wrong);
    if (!wrong) replace({ ...style, name: name.trim() });
  };

  if (!ready) {
    return (
      <aside className="styles-panel" aria-label="Path and zone styles">
        <p className={error ? "error" : "muted"}>{error ?? "Reading the styles…"}</p>
      </aside>
    );
  }

  const list = (kind: MapStyle["for"]) => {
    const own = stylesFor(styles, kind);
    return (
      <section aria-label={kind === "path" ? "Path styles" : "Zone styles"}>
        <h3>{kind === "path" ? "Path styles" : "Zone styles"}</h3>
        {own.length === 0 && <p className="muted">None yet.</p>}
        <ul>
          {own.map((style) => (
            <li key={style.id} className={open === style.id ? "is-open" : ""}>
              <span className="style-row">
                <StyleSample style={style} />
                <span className="style-name">{style.name}</span>
                {style.color === null && <em className="muted">in its layer's colour</em>}
                <Menu label={`More for ${style.name}`} className="plain row-more">
                  <MenuItem
                    icon={Pencil}
                    onSelect={() => setOpen(open === style.id ? null : style.id)}
                  >
                    Edit
                  </MenuItem>
                  <MenuItem icon={TextCursorInput} onSelect={() => void rename(style)}>
                    Rename
                  </MenuItem>
                  <MenuItem icon={Trash2} danger onSelect={() => remove(style)}>
                    Delete
                  </MenuItem>
                </Menu>
              </span>
              {open === style.id && (
                <StyleForm
                  style={style}
                  styles={styles}
                  onChange={replace}
                  onDone={() => setOpen(null)}
                />
              )}
            </li>
          ))}
        </ul>
        <button type="button" className="quiet" onClick={() => add(kind)}>
          <Icon icon={Plus} size="sm" /> {kind === "path" ? "Add a path style" : "Add a zone style"}
        </button>
      </section>
    );
  };

  return (
    <aside className="styles-panel" aria-label="Path and zone styles">
      <p className="muted styles-intro">
        Styles are kept for the whole library: a change shows on every map.
      </p>
      {error && <p className="error">{error}</p>}
      {problem && (
        <p className="error" role="alert">
          {problem}
        </p>
      )}
      {list("path")}
      {list("zone")}
      {styles.length === 0 && (
        <p className="change-actions">
          <button
            type="button"
            className="quiet"
            onClick={() => void change((f) => ({ ...f, styles: [...f.styles, ...STARTER_STYLES] }))}
          >
            Add the usual styles
          </button>
        </p>
      )}
    </aside>
  );
}
