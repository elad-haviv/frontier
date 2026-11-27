/**
 * Said to the server's owner (the first account, the only one who can revoke the keys) when they
 * open Frontier after the server deleted the AI keys it used to keep, or when provider keys are
 * still set in its environment (stage 27f). The keys were in the settings file and in backups for
 * up to 14 days: they must be revoked with each provider, and new ones made for each device.
 * Only acting on it clears it for good; "Later" and closing leave it for the next time.
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api.ts";
import { DialogFrame } from "./Dialogs.tsx";
import { useMe } from "../me.ts";
import { useStatus } from "./Shell.tsx";

export function KeysRemovedNotice() {
  const status = useStatus();
  const me = useMe();
  const navigate = useNavigate();
  const [later, setLater] = useState(false);
  const notice = status?.notices.keysRemoved;
  if (!notice || later || !me?.admin) return null;

  /** Acting on the notice: it is cleared on the server, and not shown again. */
  const act = (to?: string) => {
    setLater(true);
    void api.keysNoticeSeen().catch(() => undefined);
    if (to) navigate(to);
  };
  const names = notice.providers.join(", ");
  const vars = notice.environment.join(", ");
  return (
    <DialogFrame
      title="Revoke the AI keys Frontier used to keep"
      onCancel={() => setLater(true)}
      onSubmit={() => act("/settings/device/ai-keys")}
    >
      <p className="dialog-body">
        {notice.providers.length > 0
          ? `Frontier no longer keeps AI keys on the server, and has deleted the ones it held (${names}). `
          : "Frontier no longer keeps AI keys on the server. "}
        Copies are still in the server&apos;s backups for up to 14 days.{" "}
        <strong>
          Revoke those keys with each provider, then make new ones and add them on each of your own
          devices.
        </strong>{" "}
        Each key now stays in the browser of the person who uses it.
      </p>
      {notice.environment.length > 0 && (
        <p className="dialog-body">
          {`The server's environment still sets ${vars}. Frontier does not read ${notice.environment.length === 1 ? "it" : "them"} any more: revoke ${notice.environment.length === 1 ? "that key" : "those keys"} too and remove the setting.`}
        </p>
      )}
      <p className="dialog-actions">
        <button type="button" className="quiet" onClick={() => setLater(true)}>
          Later
        </button>
        <button type="button" className="quiet" onClick={() => act()}>
          I&apos;ve revoked them
        </button>
        <button type="submit" className="primary">
          Add a key
        </button>
      </p>
    </DialogFrame>
  );
}
