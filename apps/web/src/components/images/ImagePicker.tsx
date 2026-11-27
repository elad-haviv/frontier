import { ClipboardPaste, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiFailure } from "../../api.ts";
import { failureOf, useAsync } from "../../useAsync.ts";
import { DialogFrame } from "../Dialogs.tsx";
import { linkName } from "../editCommands.ts";
import { Icon } from "../ui/Icon.tsx";
import { Problem } from "../ui/Problem.tsx";
import { type GenerateSubmit, GeneratePanel, type PictureSubject } from "./GeneratePanel.tsx";
import { LibraryView } from "./LibraryView.tsx";
import { UrlField } from "./UrlField.tsx";
import "./ImagePicker.css";
import { projectWork } from "../../projectWork.ts";

/** The name an embed carries, from the server's `![[name]]`. */
const embedName = (embed: string) => embed.replace(/^!\[\[|\]\]$/g, "");

/**
 * The one image dialog: an image of the library, chosen by folder, name or entry; new files
 * uploaded from the device; an image from the clipboard; or one the server takes from a web
 * address. It answers the images' paths, and the names to embed them by (a name alone when no
 * other image has it, else the path). New images are unpublished uploads.
 */
export function ImagePicker({
  onPick,
  onClose,
  forMap = false,
  title,
  subject,
  start = "library",
}: {
  /** Told the images chosen; `source` is "generate" for a picture made in the dialog. */
  onPick: (paths: string[], names: string[], source?: "generate") => void;
  onClose: () => void;
  /**
   * The image of a map: one image, and none of the marker icons. Upload, paste and a web
   * address work as for an entry.
   */
  forMap?: boolean;
  /** The dialog's title, when it is not the usual one. */
  title?: string;
  /**
   * The entry being written, when pictures can be made for it (stage 29): the dialog then has a
   * Generate tab beside the library.
   */
  subject?: PictureSubject;
  /** The tab the dialog opens on. */
  start?: "library" | "generate";
}) {
  const [tab, setTab] = useState<"library" | "generate">(subject ? start : "library");
  const generate = useRef<GenerateSubmit | null>(null);
  const [canInsertPicture, setCanInsertPicture] = useState(false);
  const gallery = useAsync(() => api.gallery(), "image-picker");
  const [chosen, setChosen] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const files = useRef<HTMLInputElement>(null);
  const all = gallery.state === "ready" ? gallery.value.images : [];
  const images = forMap ? all.filter((i) => !i.icon) : all;

  const toggle = (path: string) =>
    setChosen((list) =>
      list.includes(path) ? list.filter((p) => p !== path) : forMap ? [path] : [...list, path],
    );

  /** Uploads each file as an unpublished image, then answers them all. */
  const upload = useCallback(
    async (given: File[]) => {
      const list = forMap ? given.slice(0, 1) : given;
      const done: { path: string; embed: string }[] = [];
      setProblem(null);
      // Every file goes to the project the picker was opened in, even if another is open by the
      // time the last one is sent.
      const work = projectWork();
      for (const file of list) {
        setBusy(`Adding ${file.name}…`);
        try {
          done.push(await work.api.upload(file));
        } catch (err) {
          setProblem(err instanceof ApiFailure ? err.message : "Could not add the image.");
          break;
        }
      }
      setBusy(null);
      if (done.length) {
        onPick(
          done.map((d) => d.path),
          done.map((d) => embedName(d.embed)),
        );
      }
    },
    [onPick, forMap],
  );

  async function fromWeb(url: string) {
    setProblem(null);
    setBusy("Getting the image…");
    try {
      const got = await api.imageFromUrl(url);
      onPick([got.path], [embedName(got.embed)]);
    } catch (err) {
      setProblem(err instanceof ApiFailure ? err.message : "Could not add the image.");
    } finally {
      setBusy(null);
    }
  }

  /** The Paste button reads the clipboard itself, so it works on a phone too. */
  async function pasteButton() {
    setProblem(null);
    try {
      const found: File[] = [];
      for (const item of await navigator.clipboard.read()) {
        const type = item.types.find((t) => t.startsWith("image/"));
        if (!type) continue;
        const blob = await item.getType(type);
        found.push(new File([blob], `Pasted image.${type.split("/")[1] ?? "png"}`, { type }));
      }
      if (found.length) void upload(found);
      else setProblem("There is no image on the clipboard.");
    } catch {
      setProblem("The browser did not let Frontier read the clipboard. Press Ctrl+V instead.");
    }
  }

  // Ctrl+V while the dialog is open takes the images on the clipboard.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (tab !== "library") return;
      const found = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
      if (!found.length) return;
      e.preventDefault();
      void upload(found);
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [upload, tab]);

  function insert() {
    if (tab === "generate") {
      if (generate.current?.ready) generate.current.insert();
      return;
    }
    if (!chosen.length) return;
    const all = images.map((i) => i.path);
    onPick(
      chosen,
      chosen.map((p) => linkName(p, all, true)),
    );
  }

  return (
    <DialogFrame
      title={title ?? (forMap ? "Choose an image" : "Add an image")}
      className="image-picker"
      onCancel={onClose}
      onSubmit={insert}
    >
      {subject && (
        <div className="image-picker-tabs" role="tablist" aria-label="Where the image comes from">
          {(["library", "generate"] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              aria-controls={`image-picker-${t}`}
              onClick={() => setTab(t)}
            >
              {t === "library" ? "Library" : "Generate"}
            </button>
          ))}
        </div>
      )}
      {/* Both tabs stay mounted, so a prompt or a picture being made survives a look at the library. */}
      {subject && (
        <div
          className="image-picker-generate"
          id="image-picker-generate"
          role="tabpanel"
          hidden={tab !== "generate"}
        >
          <GeneratePanel
            subject={subject}
            active={tab === "generate"}
            onPick={(paths, names) => onPick(paths, names, "generate")}
            submit={generate}
            onChange={setCanInsertPicture}
          />
        </div>
      )}
      <div
        className="image-picker-pane"
        id="image-picker-library"
        role={subject ? "tabpanel" : undefined}
        hidden={tab !== "library"}
      >
        <div className="image-picker-sources">
          <button type="button" disabled={busy !== null} onClick={() => files.current?.click()}>
            <Icon icon={Upload} size="sm" /> Upload…
          </button>
          <input
            ref={files}
            className="image-picker-files"
            type="file"
            accept="image/*"
            multiple={!forMap}
            tabIndex={-1}
            aria-hidden="true"
            onChange={(e) => {
              const picked = [...(e.target.files ?? [])];
              e.target.value = "";
              if (picked.length) void upload(picked);
            }}
          />
          <button type="button" disabled={busy !== null} onClick={() => void pasteButton()}>
            <Icon icon={ClipboardPaste} size="sm" /> Paste image
          </button>
          <UrlField busy={busy !== null} onAdd={(url) => void fromWeb(url)} />
        </div>
        {busy && (
          <p className="image-picker-busy muted" role="status">
            {busy}
          </p>
        )}
        {problem && (
          <p className="image-picker-problem" role="alert">
            {problem}
          </p>
        )}
        <div className="image-picker-library">
          {gallery.state === "loading" && <p className="muted">Loading the library…</p>}
          {failureOf(gallery) && (
            <Problem reason={failureOf(gallery)!.message} onRetry={gallery.retry} />
          )}
          {gallery.state === "ready" && (
            <LibraryView images={images} mode="pick" chosen={new Set(chosen)} onToggle={toggle} />
          )}
        </div>
      </div>
      <p className="dialog-actions">
        <button type="button" onClick={onClose}>
          Cancel
        </button>
        {tab === "generate" ? (
          <button type="submit" className="primary" disabled={!canInsertPicture}>
            Insert
          </button>
        ) : (
          <button type="submit" className="primary" disabled={chosen.length === 0}>
            {forMap ? "Choose" : chosen.length > 1 ? `Insert ${chosen.length} images` : "Insert"}
          </button>
        )}
      </p>
    </DialogFrame>
  );
}
