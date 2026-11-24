import { useCallback, useEffect, useState } from "react";
import { clearDeviceCopy, deviceSpace } from "../offline/copy.ts";
import { useDialogs } from "./Dialogs.tsx";
import { InstallCard, needsInstallCard } from "./InstallCard.tsx";

/** A size in words: "41 MB", "0.4 MB", "12 KB". */
export function sizeOf(bytes: number): string {
  if (bytes < 100_000) return `${Math.max(1, Math.round(bytes / 1000))} KB`;
  const mb = bytes / 1_000_000;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

/**
 * "On this device" in Settings: what the device keeps for reading offline, and a way to remove
 * it. It reads only the device, so it shows with no connection.
 */
export function OnThisDevice() {
  const dialogs = useDialogs();
  const [space, setSpace] = useState<number | null | undefined>(undefined);
  const load = useCallback(() => {
    deviceSpace().then(setSpace, () => setSpace(null));
  }, []);
  useEffect(load, [load]);

  async function remove() {
    const ok = await dialogs.confirm({
      title: "Remove the copies of entries, maps and chronicles on this device?",
      body: "Changes not sent yet stay.",
      action: "Remove",
      danger: true,
    });
    if (!ok) return;
    await clearDeviceCopy();
    load();
  }

  return (
    <section className="settings-block on-this-device">
      <h2>On this device</h2>
      {needsInstallCard() && <InstallCard />}
      {space === undefined ? (
        <p className="muted">Reading…</p>
      ) : space === null ? (
        <p>This browser does not let Frontier keep anything on this device.</p>
      ) : (
        <>
          <p>
            Frontier keeps the entries, maps and chronicles you opened last on this device, so they
            open with no connection.
          </p>
          <p>Space used: {sizeOf(space)}</p>
          <button type="button" className="quiet danger" onClick={() => void remove()}>
            Remove everything on this device
          </button>
        </>
      )}
    </section>
  );
}
