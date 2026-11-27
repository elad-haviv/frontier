import { useCallback } from "react";
import { resetAccess } from "../access.ts";
import { api, ApiFailure } from "../api.ts";
import { clearMe } from "../me.ts";
import { wipeDevice } from "../offline/wipe.ts";
import { clearProjects } from "../projects.ts";
import { queue } from "../sync/queue.ts";
import { useDialogs } from "./Dialogs.tsx";
import { useToast } from "./ui/Toast.tsx";

/**
 * Logs out, after warning about changes not sent yet (in every project: they are all kept only
 * on this device). Used by the app menu in a project and by the account menu outside one. `after` is
 * where the page goes once logged out: the login page, or an invite link to join with another account.
 */
export function useLogoutAction(after = "/login"): () => void {
  const dialogs = useDialogs();
  const toast = useToast();
  return useCallback(() => {
    void (async () => {
      // In every project, those of projects that are gone included: all are kept only here.
      const unsent = Math.max(queue.total(), await queue.unsentOnDevice());
      if (unsent > 0) {
        const ok = await dialogs.confirm({
          title: unsent === 1 ? "1 change is not sent yet" : `${unsent} changes are not sent yet`,
          body: "They are kept only on this device, and logging out removes them from it. Log out all the same?",
          action: "Log out and lose them",
          danger: true,
        });
        if (!ok) return;
      }
      // Only the server's answer removes the session cookie, so nothing is wiped without it.
      try {
        await api.logout();
      } catch (err) {
        const offline = !(err instanceof ApiFailure) || err.status === 0;
        toast({
          message: `Could not log out: ${offline ? "no connection." : (err as ApiFailure).message}`,
        });
        return;
      }
      // A borrowed device keeps nothing: the queues and this device's id go, then the app's caches
      // and its service worker. The other tabs hear it and reload too.
      await queue.clear();
      clearMe();
      clearProjects();
      resetAccess();
      await wipeDevice({
        store: queue,
        caches: typeof caches === "undefined" ? undefined : caches,
        container: navigator.serviceWorker,
      });
      window.location.assign(after);
    })();
  }, [dialogs, toast, after]);
}
