import { Share } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { FIRST_ITEM } from "../offline/copy.ts";
import { database } from "../sync/db.ts";
import { Icon } from "./ui/Icon.tsx";

/** In Safari on an iPhone or iPad, not installed: the offline copy lasts only on the Home Screen. */
export function needsInstallCard(): boolean {
  if (typeof navigator === "undefined") return false;
  const apple =
    /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  const installed =
    (navigator as { standalone?: boolean }).standalone === true ||
    (typeof matchMedia === "function" && matchMedia("(display-mode: standalone)").matches);
  return apple && !installed;
}

/** How to put Frontier on the Home Screen, and why. */
export function InstallCard({ onDismiss }: { onDismiss?: () => void }) {
  return (
    <div className="install-card" role="note">
      <p>
        On iPhone, Frontier keeps its offline copy only when it is on your Home Screen. The Home
        Screen app has its own storage: send any waiting changes from here first, and log in once
        there.
      </p>
      <p className="muted">
        In Safari, press Share <Icon icon={Share} size="sm" />, then “Add to Home Screen”.
      </p>
      {onDismiss && (
        <button type="button" className="quiet" onClick={onDismiss}>
          Dismiss
        </button>
      )}
    </div>
  );
}

const SHOWN = "frontier.installNotice";

/**
 * Notices about this device, over the page: the install card once, the first time an item is
 * kept on an iPhone in Safari; and the database's word when another tab runs another build.
 */
export function DeviceNotices() {
  const [card, setCard] = useState(false);
  useEffect(() => {
    const first = () => {
      try {
        if (!needsInstallCard() || localStorage.getItem(SHOWN)) return;
        localStorage.setItem(SHOWN, "1");
      } catch {
        return;
      }
      setCard(true);
    };
    window.addEventListener(FIRST_ITEM, first);
    return () => window.removeEventListener(FIRST_ITEM, first);
  }, []);
  const db = useSyncExternalStore(
    (l) => {
      database.listeners.add(l);
      return () => database.listeners.delete(l);
    },
    () => (database.closed ? "closed" : database.waiting ? "waiting" : "open"),
  );
  return (
    <>
      {db === "closed" && (
        // Over the whole page, so nothing more is typed into a database this tab let go of.
        <div className="db-closed" role="alertdialog" aria-label="Frontier was updated">
          <p>
            Frontier was updated in another tab. Reload this tab.{" "}
            <button type="button" className="primary" onClick={() => window.location.reload()}>
              Reload
            </button>
          </p>
        </div>
      )}
      {db === "waiting" && (
        <p className="banner device-notice" role="status">
          Close or reload your other Frontier tabs to finish updating.
        </p>
      )}
      {card && (
        <div className="device-notice">
          <InstallCard onDismiss={() => setCard(false)} />
        </div>
      )}
    </>
  );
}
