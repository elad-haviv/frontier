/**
 * This device › AI keys (stage 27f): the providers and what this browser holds for each. A key is
 * kept only here, in this browser; the server never saves one. Test is a real check through the
 * server with the key in that one request. Everything but Test works with no connection, since
 * the keys are device state.
 */
import { AI_PROVIDER_KINDS, AiProviderKind, maskKey, splitModelId } from "@frontier/schema";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiFailure } from "../../api.ts";
import { recordCheck, removeDeviceKey, useDeviceKeys } from "../../aiKeys.ts";
import { AiKeyForm } from "../../components/AiKeyForm.tsx";
import { useDialogs } from "../../components/Dialogs.tsx";
import { ActionButton } from "../../components/ui/ActionButton.tsx";
import { useNeedsConnection } from "../../sync/connection.ts";
import { ago, kindLabel, ProviderMark, taskTitle, useSettingsData } from "./shared.tsx";

/** The providers always listed; the others show once they hold a key or a task uses them. */
const MAIN: AiProviderKind[] = ["openrouter", "anthropic", "openai", "google", "xai"];

function KeyRow({ kind, tasks }: { kind: AiProviderKind; tasks: string[] }) {
  const dialogs = useDialogs();
  const offline = useNeedsConnection();
  const { keys, checks } = useDeviceKeys();
  const [testing, setTesting] = useState(false);
  const [adding, setAdding] = useState(false);
  const key = keys[kind];
  const check = checks[kind];

  async function test() {
    if (!key) return;
    setTesting(true);
    try {
      const r = await api.checkKey(kind, key);
      recordCheck(kind, {
        at: new Date().toISOString(),
        ok: r.ok,
        message: r.ok ? null : r.message,
      });
    } catch (err) {
      recordCheck(kind, {
        at: new Date().toISOString(),
        ok: false,
        message: err instanceof ApiFailure ? err.message : "The key could not be tested.",
      });
    } finally {
      setTesting(false);
    }
  }

  async function remove() {
    const ok = await dialogs.confirm({
      title: `Remove the ${kindLabel(kind)} key from this device?`,
      body:
        tasks.length > 0
          ? `${tasks.join(" and ")} ${tasks.length === 1 ? "uses" : "use"} ${kindLabel(kind)}, and will ask for a key again.`
          : "It is deleted from this browser. Your provider still has it, so you can add it again.",
      action: "Remove",
      danger: true,
    });
    if (ok) removeDeviceKey(kind);
  }

  return (
    <li className={`provider-row ${key && check?.ok === false ? "is-failing" : ""}`}>
      <ProviderMark kind={kind} />
      <div className="provider-body">
        <div className="provider-name">{kindLabel(kind)}</div>
        <div className="provider-status">
          {!key ? (
            <span className={`status ${tasks.length > 0 ? "bad" : "off"}`}>
              <span className={`dot ${tasks.length > 0 ? "bad" : "off"}`} /> No key on this device
            </span>
          ) : check?.ok === false ? (
            <span className="status bad">
              <span className="dot bad" /> Not working
            </span>
          ) : check?.ok ? (
            <span className="status ok">
              <span className="dot ok" /> Working
            </span>
          ) : (
            <span className="status off">
              <span className="dot off" /> Kept, not tested yet
            </span>
          )}
          <span className="muted">
            {key && ` · key ${maskKey(key)}`}
            {key && check && ` · tested ${ago(check.at)}`}
          </span>
        </div>
        {key && check?.ok === false && check.message && (
          <p className="field-error">{check.message}</p>
        )}
        {tasks.length > 0 && (
          <p className="provider-used">
            Used for{" "}
            {tasks.map((t, i) => (
              <span key={t}>
                {i > 0 && ", "}
                <Link to="/settings/you/ai-models">{t}</Link>
              </span>
            ))}
          </p>
        )}
        {adding && (
          <AiKeyForm
            initial={kind}
            onKept={() => setAdding(false)}
            onCancel={() => setAdding(false)}
          />
        )}
      </div>
      {!adding && (
        <div className="provider-actions">
          {key && (
            <ActionButton
              type="button"
              className="quiet"
              disabled={testing || offline !== undefined}
              title={offline}
              onClick={() => void test()}
            >
              {testing ? "Testing…" : "Test"}
            </ActionButton>
          )}
          <button type="button" className="plain" onClick={() => setAdding(true)}>
            {key ? "Replace key" : "Add a key"}
          </button>
          {key && (
            <button type="button" className="plain danger" onClick={() => void remove()}>
              Remove from this device
            </button>
          )}
        </div>
      )}
    </li>
  );
}

export function AiKeys() {
  const { settings } = useSettingsData();
  const { keys } = useDeviceKeys();
  const used = new Map<string, string[]>();
  for (const [task, id] of Object.entries(settings?.ai.models ?? {})) {
    if (!id) continue;
    const provider = splitModelId(id).provider;
    used.set(provider, [...(used.get(provider) ?? []), taskTitle(task)]);
  }
  const shown = AiProviderKind.options.filter(
    (k) => MAIN.includes(k) || keys[k] !== undefined || used.has(k),
  );

  return (
    <section className="settings-block">
      <div className="settings-note" role="note">
        <p>
          <strong>Your keys stay in this browser.</strong>
        </p>
        <ul>
          <li>The server never saves them and other members never see them.</li>
          <li>You pay your provider directly for what you use.</li>
          <li>
            On another phone or computer add the key again, and clearing this browser&apos;s data
            removes it.
          </li>
        </ul>
      </div>
      <p className="muted">
        What changes without a server key: AI work happens only while you have Frontier open. The
        question of the day and field proposals are made when you open the page, not overnight.
      </p>
      <ul className="provider-list">
        {shown.map((kind) => (
          <KeyRow key={kind} kind={kind} tasks={used.get(kind) ?? []} />
        ))}
      </ul>
      <p className="muted small">
        Set a hard spending limit with your provider too:{" "}
        {MAIN.map((k, i) => (
          <span key={k}>
            {i > 0 && ", "}
            <a
              href={AI_PROVIDER_KINDS[k].billingUrl ?? "#"}
              target="_blank"
              rel="noreferrer noopener"
            >
              {kindLabel(k)}
            </a>
          </span>
        ))}
        .
      </p>
    </section>
  );
}
