import { useConnection } from "../../sync/connection.ts";
import { type QueueKey, useRecord } from "../../sync/queue.ts";
import "./SaveStatus.css";

/**
 * Where a page's changes are: saved as a draft on the server, on their way, unsent and kept on
 * this device, refused by the server, or (for an entry) kept beside a newer text to compare.
 */
export type SaveState = "saved" | "saving" | "offline" | "failed" | "stale";

const WORDS: Record<SaveState, string> = {
  saved: "Saved as a draft",
  saving: "Saving…",
  offline: "Unsent: kept on this device",
  failed: "Not saved",
  stale: "Two texts to compare",
};

/** The save state of one file, from its record in the queue and the connection. */
export function useSaveState(key: QueueKey | null): { state: SaveState; error: string | null } {
  const record = useRecord(key);
  const { state: connection } = useConnection();
  if (!record) return { state: "saved", error: null };
  if (record.state === "attention") return { state: "failed", error: record.error ?? null };
  // Not sent for want of a connection, or of a login: it waits on this device.
  if (connection !== "online" || record.tries > 0) {
    return { state: "offline", error: record.error ?? null };
  }
  return { state: "saving", error: null };
}

/**
 * The one save-state line every page shows. It keeps the class names pages had before it
 * (`save-state save-<state>`, or `ch-saving` on a chronicle), so styles and tests still find it.
 */
export function SaveStatus({
  state,
  variant = "bar",
  title,
}: {
  state: SaveState;
  /** `chronicle` draws it as the chronicle's bar has it. */
  variant?: "bar" | "chronicle";
  title?: string;
}) {
  const className =
    variant === "chronicle"
      ? `ch-saving save-${state} ${state === "failed" || state === "offline" ? "error" : "muted"}`
      : `save-state save-${state}`;
  return (
    <span className={`ui-save-status ${className}`} role="status" title={title ?? WORDS[state]}>
      {WORDS[state]}
    </span>
  );
}
