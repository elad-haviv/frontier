import { useCallback, useEffect, useState } from "react";
import { clearDeviceCopyOf, deviceSpaces } from "../offline/copy.ts";
import { useOnDevice, useProjects } from "../projects.ts";
import { useProjectOrNull } from "./projectContext.ts";
import { useDialogs } from "./Dialogs.tsx";
import { InstallCard, needsInstallCard } from "./InstallCard.tsx";

/** A size in words: "41 MB", "0.4 MB", "12 KB". */
export function sizeOf(bytes: number): string {
  if (bytes < 100_000) return `${Math.max(1, Math.round(bytes / 1000))} KB`;
  const mb = bytes / 1_000_000;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

/**
 * "On this device" in Settings: what the device keeps for reading offline, project by project,
 * and a way to remove each. It reads only the device, so it shows with no connection.
 */
export function OnThisDevice() {
  const dialogs = useDialogs();
  const open = useProjectOrNull();
  const { list } = useProjects();
  const onDevice = useOnDevice();
  const [spaces, setSpaces] = useState<Map<string, number | null> | undefined>(undefined);
  // The projects that hold a copy here, the open one first even before it has kept anything.
  const here = (list?.projects ?? [])
    .filter((p) => onDevice.has(p.id) || p.id === open?.id)
    .sort((a, b) => Number(b.id === open?.id) - Number(a.id === open?.id));
  const key = here.map((p) => p.id).join(",");
  const load = useCallback(() => {
    deviceSpaces(here.map((p) => ({ id: p.id, slug: p.slug }))).then(
      (all) => setSpaces(new Map(all.map((s) => [s.id, s.bytes]))),
      () => setSpaces(new Map()),
    );
    // Reads again when the set of projects changes.
  }, [key]);
  useEffect(load, [load]);

  async function remove(p: { id: string; slug: string; name: string }) {
    const ok = await dialogs.confirm({
      title: `Remove the copies of entries, maps and chronicles of ${p.name} on this device?`,
      body: "Changes not sent yet stay.",
      action: "Remove",
      danger: true,
    });
    if (!ok) return;
    await clearDeviceCopyOf(p);
    load();
  }

  const nothing = spaces !== undefined && [...spaces.values()].every((b) => b === null);
  return (
    <section className="settings-block on-this-device">
      <h2>On this device</h2>
      {needsInstallCard() && <InstallCard />}
      {spaces === undefined ? (
        <p className="muted">Reading…</p>
      ) : nothing && here.length > 0 ? (
        <p>This browser does not let Frontier keep anything on this device.</p>
      ) : (
        <>
          <p>
            Frontier keeps the entries, maps and chronicles you opened last in each project on this
            device, so they open with no connection. Each project's copy is its own.
          </p>
          {here.length === 0 ? (
            <p className="muted">Nothing is kept on this device yet.</p>
          ) : (
            <ul className="device-projects">
              {here.map((p) => (
                <li key={p.id}>
                  <div>
                    <strong id={`device-${p.id}`}>{p.name}</strong>
                    {p.id === open?.id && <span className="muted"> · open now</span>}
                    <p>Space used: {sizeOf(spaces.get(p.id) ?? 0)}</p>
                  </div>
                  <button
                    type="button"
                    className="quiet danger"
                    onClick={() => void remove(p)}
                    aria-describedby={`device-${p.id}`}
                  >
                    Remove everything on this device
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
