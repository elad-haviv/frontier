/**
 * Whether the "Not sent yet" list is open. It is kept here, outside the button that opens it, so
 * that a page or a notice that says "your changes are in Not sent yet" can open it.
 */
import { useSyncExternalStore } from "react";

let open = false;
const listeners = new Set<() => void>();

/** Opens or closes the list. */
export function setUnsentOpen(next: boolean): void {
  if (open === next) return;
  open = next;
  for (const l of [...listeners]) l();
}

/** Opens the list of changes not sent yet. */
export const showUnsent = (): void => setUnsentOpen(true);

/** Whether the list is open, and a way to set it; renders again when it changes. */
export function useUnsentOpen(): [boolean, (next: boolean) => void] {
  const now = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => open,
    () => open,
  );
  return [now, setUnsentOpen];
}
