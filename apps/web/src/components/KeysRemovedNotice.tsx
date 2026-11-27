/**
 * Said once, to whoever opens Frontier first after the server deleted the AI keys it used to
 * keep (stage 27f). Keys now stay on each device, so each has to be added again on every device
 * that uses AI. Seen once, it is cleared on the server and not shown again.
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api.ts";
import { DialogFrame } from "./Dialogs.tsx";
import { useStatus } from "./Shell.tsx";

export function KeysRemovedNotice() {
  const status = useStatus();
  const navigate = useNavigate();
  const [closed, setClosed] = useState(false);
  const notice = status?.notices.keysRemoved;
  if (!notice || closed) return null;

  const close = (to?: string) => {
    setClosed(true);
    void api.keysNoticeSeen().catch(() => undefined);
    if (to) navigate(to);
  };
  const names = notice.providers.join(", ");
  return (
    <DialogFrame
      title="Your AI keys were removed from the server"
      onCancel={() => close()}
      onSubmit={() => close("/settings/device/ai-keys")}
    >
      <p className="dialog-body">
        {`Frontier no longer keeps AI keys on the server${names ? ` (${names})` : ""}. Each key now stays in the browser of the person who uses it. Add your key again on each phone or computer you use for AI help.`}
      </p>
      <p className="dialog-actions">
        <button type="button" className="quiet" onClick={() => close()}>
          Later
        </button>
        <button type="submit" className="primary">
          Add a key
        </button>
      </p>
    </DialogFrame>
  );
}
