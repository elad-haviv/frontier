import { displayKey, useRegistry } from "../keys.ts";
import { DialogFrame } from "./Dialogs.tsx";
import "./KeySheet.css";

/**
 * The "?" sheet: every shortcut of the screen that is open and of the whole app, read from the
 * keys registry, together with the keys that menus, lists and dialogs handle themselves.
 */
export function KeySheet({ onClose }: { onClose: () => void }) {
  const registry = useRegistry();
  const groups = registry.sheet();
  return (
    <DialogFrame
      title="Keyboard shortcuts"
      onCancel={onClose}
      onSubmit={onClose}
      className="key-sheet"
    >
      <div className="key-sheet-groups">
        {groups.map((g) => (
          <section key={g.scope} className="key-sheet-group">
            <h3>{g.name}</h3>
            <dl>
              {g.items.map((s) => (
                <div key={s.id} className="key-sheet-row">
                  <dt>{s.label}</dt>
                  <dd>
                    {s.keys.map((k, i) => (
                      <span key={k}>
                        {i > 0 && <span className="key-sheet-or"> or </span>}
                        <kbd>{displayKey(k)}</kbd>
                      </span>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
      <p className="dialog-actions">
        <button type="submit" className="primary">
          Close
        </button>
      </p>
    </DialogFrame>
  );
}
