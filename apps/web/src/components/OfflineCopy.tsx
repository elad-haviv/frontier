import { CloudOff } from "lucide-react";
import { useEffect, useRef } from "react";
import { onFresh } from "../offline/copy.ts";
import { connection } from "../sync/connection.ts";
import { Icon } from "./ui/Icon.tsx";
import "./OfflineCopy.css";

const time = (d: Date) => d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

/** "14:05" today, "yesterday, 18:40", else the date and time. */
export function whenStored(at: number, now = Date.now()): string {
  const d = new Date(at);
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((day(new Date(now)) - day(d)) / 86_400_000);
  if (days <= 0) return time(d);
  if (days === 1) return `yesterday, ${time(d)}`;
  return `${d.toLocaleDateString(undefined, { day: "numeric", month: "short" })}, ${time(d)}`;
}

/**
 * For a page showing a device answer: calls `again` when the server's answer for `url` arrives
 * late, or when the connection comes back, so the page reads the server's copy.
 */
export function useReadAgain(at: number | null, url: string, again: () => void): void {
  const call = useRef(again);
  call.current = again;
  useEffect(() => {
    if (at === null) return;
    let online = connection.state === "online";
    const stopFresh = onFresh((u) => u === url && call.current());
    const stopConnection = connection.subscribe(() => {
      const now = connection.state === "online";
      if (now && !online) call.current();
      online = now;
    });
    return () => {
      stopFresh();
      stopConnection();
    };
  }, [at, url]);
}

/**
 * Says that what the page shows was read from this device, and when it was stored: "Offline copy
 * from 14:05". Nothing while the page shows the server's answer.
 */
export function OfflineCopy({ at, className }: { at: number | null; className?: string }) {
  if (at === null) return null;
  return (
    <p className={`offline-copy${className ? ` ${className}` : ""}`} role="status">
      <Icon icon={CloudOff} size="sm" />
      Offline copy from {whenStored(at)}
    </p>
  );
}
