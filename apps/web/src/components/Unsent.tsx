import * as Popover from "@radix-ui/react-popover";
import { CloudOff } from "lucide-react";
import { Link } from "react-router-dom";
import { chronicleUrl, editUrl, mapUrl } from "../api.ts";
import {
  nameOf,
  queue,
  type QueueKey,
  type QueueRecord,
  subject,
  useUnsent,
} from "../sync/queue.ts";
import { useDialogs } from "./Dialogs.tsx";
import { Icon } from "./ui/Icon.tsx";
import "./Unsent.css";

/** Where a file is changed: the editor for an entry, the page of a map or chronicle. */
function pageOf(key: QueueKey): string | null {
  if (key.startsWith("entry:")) return editUrl(subject(key));
  if (key.startsWith("map:")) return mapUrl(subject(key));
  if (key.startsWith("chronicle:")) return chronicleUrl(subject(key));
  return null;
}

function age(since: number): string {
  const minutes = Math.round((Date.now() - since) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(since).toLocaleDateString();
}

function Row({ record }: { record: QueueRecord }) {
  const dialogs = useDialogs();
  const href = pageOf(record.key);
  const name = nameOf(record);
  async function discard() {
    const ok = await dialogs.confirm({
      title: `Throw away the unsent change to ${name}?`,
      body: "It exists only on this device. What the server holds stays as it is.",
      action: "Throw it away",
      danger: true,
    });
    if (ok) await queue.drop(record.key);
  }
  return (
    <li className={`unsent-row${record.state === "attention" ? " needs-attention" : ""}`}>
      <p className="unsent-name">
        {href ? <Link to={href}>{name}</Link> : name}
        {record.kind === "delete" && <span className="muted"> (delete)</span>}
        <span className="muted unsent-age">{age(record.since)}</span>
      </p>
      {record.error && <p className="unsent-error">{record.error}</p>}
      {record.state === "attention" && (
        <p className="unsent-actions">
          <button type="button" className="quiet" onClick={() => void queue.retry(record.key)}>
            Retry
          </button>
          <button type="button" className="quiet danger" onClick={() => void discard()}>
            Discard
          </button>
        </p>
      )}
    </li>
  );
}

/**
 * The count of changes still on this device, which opens the list of them: each file with its
 * age and any error, and Retry and Discard for those the server refused.
 */
export function Unsent({ compact = false }: { compact?: boolean }) {
  const records = useUnsent();
  if (records.length === 0) return null;
  const attention = records.filter((r) => r.state === "attention").length;
  const kept = queue.kept;
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={`unsent-count${attention > 0 ? " needs-attention" : ""}${compact ? " is-compact" : ""}`}
          title={
            kept
              ? "Changes kept on this device, not sent yet"
              : "Changes are not kept on this device"
          }
        >
          <Icon icon={CloudOff} size="sm" />
          {compact ? <span className="sr-only">Unsent</span> : "Unsent"}
          <span className="badge">{records.length}</span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="unsent"
          align={compact ? "start" : "end"}
          sideOffset={6}
          collisionPadding={8}
        >
          <h2 className="unsent-title">Not sent yet</h2>
          <p className="muted unsent-note">
            {kept
              ? "Kept on this device, and sent when the server can take them."
              : "Changes are not kept on this device: they go if this page is closed."}
          </p>
          <ul>
            {records.map((r) => (
              <Row key={r.key} record={r} />
            ))}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
