import { ClipboardPaste, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiFailure } from "../../api.ts";
import { failureOf, useAsync } from "../../useAsync.ts";
import { DialogFrame } from "../Dialogs.tsx";
import { linkName } from "../editCommands.ts";
import { Icon } from "../ui/Icon.tsx";
import { Problem } from "../ui/Problem.tsx";
import { LibraryView } from "./LibraryView.tsx";
import { UrlField } from "./UrlField.tsx";
import "./ImagePicker.css";

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
}: {
  onPick: (paths: string[], names: string[]) => void;
  onClose: () => void;
  /**
   * The image of a map: one image, and none of the marker icons. Upload, paste and a web
   * address work as for an entry.
   */
  forMap?: boolean;
}) {
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
      for (const file of list) {
        setBusy(`Adding ${file.name}…`);
        try {
          done.push(await api.upload(file));
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
      const found = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
      if (!found.length) return;
      e.preventDefault();
      void upload(found);
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [upload]);

  function insert() {
    if (!chosen.length) return;
    const all = images.map((i) => i.path);
    onPick(
      chosen,
      chosen.map((p) => linkName(p, all, true)),
    );
  }

  return (
    <DialogFrame
      title={forMap ? "Choose an image" : "Add an image"}
      className="image-picker"
      onCancel={onClose}
      onSubmit={insert}
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
      <p className="dialog-actions">
        <button type="button" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className="primary" disabled={chosen.length === 0}>
          {forMap ? "Choose" : chosen.length > 1 ? `Insert ${chosen.length} images` : "Insert"}
        </button>
      </p>
    </DialogFrame>
  );
}
