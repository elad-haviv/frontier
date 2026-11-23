import { useId, useState } from "react";

/**
 * A web address to take an image from. The server fetches it, so the browser needs no leave from
 * the image's site. Enter adds it, as the button does.
 */
export function UrlField({ busy, onAdd }: { busy: boolean; onAdd: (url: string) => void }) {
  const [url, setUrl] = useState("");
  const id = useId();
  const add = () => {
    const wanted = url.trim();
    if (wanted && !busy) onAdd(wanted);
  };
  return (
    <div className="image-picker-url">
      <label htmlFor={id}>From a web address</label>
      <div className="image-picker-url-row">
        <input
          id={id}
          type="url"
          inputMode="url"
          placeholder="https://…"
          value={url}
          maxLength={2048}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            add();
          }}
        />
        <button type="button" disabled={busy || url.trim() === ""} onClick={add}>
          {busy ? "Getting…" : "Add"}
        </button>
      </div>
    </div>
  );
}
