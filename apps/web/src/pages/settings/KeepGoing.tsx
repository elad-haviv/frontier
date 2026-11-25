/**
 * Library › Keep going: which rules put an entry on Home's "Needs love" list. Each switch saves as
 * it changes.
 */
import { NEEDS_LOVE_LABELS, NEEDS_LOVE_RULES, type NeedsLoveRule } from "@frontier/schema";
import { useEffect, useState } from "react";
import { api } from "../../api.ts";
import { useNeedsConnection } from "../../sync/connection.ts";
import { Saved, useAutoSave, useSettingsData } from "./shared.tsx";

export function KeepGoing() {
  const { settings, reload } = useSettingsData();
  const offline = useNeedsConnection();
  const saving = useAutoSave();
  const stored = settings?.keepGoing.needsLove;
  const [rules, setRules] = useState(stored);
  useEffect(() => setRules(stored), [stored]);
  if (!settings || !rules) return null;

  function change(rule: NeedsLoveRule, on: boolean) {
    setRules((r) => r && { ...r, [rule]: on });
    void saving
      .run(() => api.setKeepGoingSettings({ needsLove: { [rule]: on } }))
      .then(async (ok) => {
        if (ok) await reload();
        else setRules(stored);
      });
  }

  return (
    <section className="settings-block">
      <p className="muted">
        Home lists the entries that need the most work. An entry is listed when it trips any of
        these rules; switch off the ones you do not care about. Entries that more entries link to
        come first.
      </p>
      <div className="keep-going-rules" role="group" aria-label="Rules for entries that need love">
        {NEEDS_LOVE_RULES.map((rule) => (
          <label key={rule} className="check">
            <input
              type="checkbox"
              checked={rules[rule]}
              disabled={saving.busy || offline !== undefined}
              onChange={(e) => change(rule, e.target.checked)}
            />
            <span>{NEEDS_LOVE_LABELS[rule]}</span>
          </label>
        ))}
      </div>
      <p aria-live="polite">
        <Saved at={saving.savedAt} />
        {saving.error && <span className="error">{saving.error}</span>}
      </p>
    </section>
  );
}
