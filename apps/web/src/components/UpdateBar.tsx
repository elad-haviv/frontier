import { useUpdate } from "../offline/updates.ts";
import "./UpdateBar.css";

/**
 * "A new version of Frontier is ready", above the page, once a new version waits and nothing is
 * being sent and no editor has the focus. The new version takes over only when the author presses
 * Reload, in every open tab at once.
 */
export function UpdateBar() {
  const { offer, reload, later } = useUpdate();
  if (!offer) return null;
  return (
    <div className="update-bar" role="status">
      <span className="update-bar-words">A new version of Frontier is ready</span>
      <button type="button" className="primary" onClick={reload}>
        Reload
      </button>
      <button type="button" className="quiet" onClick={later}>
        Later
      </button>
    </div>
  );
}
