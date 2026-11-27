import { type ReactNode, useCallback, useState } from "react";
import { useNavigate } from "../nav.tsx";
import { api, editUrl } from "../api.ts";
import { useAsync } from "../useAsync.ts";
import { NewEntry } from "./NewEntry.tsx";

/** A new entry asked for by name, with the folder it most likely belongs in. */
export interface WriteRequest {
  /** The name to start from, such as a link's words. */
  name: string;
  /** The folder to offer first; null or "" for none, which offers the top of the library. */
  folder?: string | null;
}

/** The New entry dialog for one request, loading the folders only while it is open. */
function WriteDialog({ request, onClose }: { request: WriteRequest; onClose: () => void }) {
  const navigate = useNavigate();
  const [attempt, setAttempt] = useState(0);
  const tree = useAsync(() => api.tree(), `write-it:${attempt}`);
  return (
    <NewEntry
      tree={tree}
      folder={request.folder ?? ""}
      name={request.name}
      onRetry={() => setAttempt((n) => n + 1)}
      onMake={(path, type) => {
        onClose();
        navigate(`${editUrl(path)}?new=1${type ? `&type=${encodeURIComponent(type)}` : ""}`);
      }}
      onClose={onClose}
    />
  );
}

/**
 * "Write it" (stage 25): opens the ordinary New entry dialog with a name and a likely folder
 * filled in, and on making it opens the editor, as New entry in the side bar does. Put `dialog`
 * in the page's output and call `write` from a button:
 *
 *     const { write, dialog } = useWriteIt();
 *     <button onClick={() => write({ name: row.name, folder: row.folder })}>Write</button>
 *     {dialog}
 */
export function useWriteIt(): {
  write: (request: WriteRequest) => void;
  dialog: ReactNode;
} {
  const [request, setRequest] = useState<WriteRequest | null>(null);
  const close = useCallback(() => setRequest(null), []);
  return {
    write: setRequest,
    dialog: request ? <WriteDialog request={request} onClose={close} /> : null,
  };
}
