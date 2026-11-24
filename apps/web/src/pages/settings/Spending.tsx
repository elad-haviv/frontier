/**
 * AI › Spending: this month against the cap, by provider with how each cost is known, and the
 * log of calls with a month switch. The cap saves on blur or Enter.
 */
import {
  AI_PROVIDER_KINDS,
  type AiLogResponse,
  type AiProviderKind,
  splitModelId,
} from "@frontier/schema";
import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, entryUrl } from "../../api.ts";
import { Problem } from "../../components/ui/Problem.tsx";
import { Progress } from "../../components/ui/Progress.tsx";
import { useRefresh } from "../../components/Shell.tsx";
import { useAsync } from "../../useAsync.ts";
import { Saved, taskTitle, useAutoSave, useSettingsData } from "./shared.tsx";

const thisMonth = () => new Date().toISOString().slice(0, 7);
const shift = (month: string, by: number) => {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return d.toISOString().slice(0, 7);
};
const monthName = (month: string, withYear = true) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleDateString(undefined, {
    month: "long",
    ...(withYear ? { year: "numeric" } : {}),
    timeZone: "UTC",
  });

const dollars = (n: number) => (n > 0 && n < 0.01 ? "under $0.01" : `$${n.toFixed(2)}`);

/** "Today 11:03", "Yesterday 09:12", or a date and a time. */
function when(iso: string): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  const day = new Date(d).setHours(0, 0, 0, 0);
  const today = new Date().setHours(0, 0, 0, 0);
  if (day === today) return `Today ${time}`;
  if (today - day === 86_400_000) return `Yesterday ${time}`;
  return `${d.toLocaleDateString(undefined, { day: "numeric", month: "short" })} ${time}`;
}

const stem = (path: string) => path.split("/").pop()!.replace(/\.md$/i, "");

/** What a call was for, in words, linked to its entry where it has one. */
function What({ call }: { call: AiLogResponse["calls"][number] }) {
  const e = call.entry;
  const entry =
    e && e.endsWith(".md") ? (
      <>
        {" · "}
        <Link to={entryUrl(e)}>{stem(e)}</Link>
      </>
    ) : null;
  if (e === "test") return <>Try it · {taskTitle(call.task)}</>;
  if (call.task === "extraction") return <>Proposed fields{entry}</>;
  if (call.task === "art") return <>Concept art</>;
  if (e?.startsWith("map:")) return <>Exploring a map</>;
  if (e?.startsWith("character:")) return <>Talking with{entry}</>;
  return <>Lore conversation{entry}</>;
}

function Cost({ call }: { call: AiLogResponse["calls"][number] }) {
  if (!call.ok) return <span title={call.error}>failed{call.error ? `: ${call.error}` : ""}</span>;
  if (call.costKind === "unknown")
    return <span title="No price is known: not counted">unknown</span>;
  return (
    <span
      title={call.costKind === "estimated" ? "Estimated from the price and the tokens" : undefined}
    >
      {call.costKind === "estimated" ? "≈ " : ""}
      {dollars(call.costUsd)}
    </span>
  );
}

function Cap() {
  const { settings, reload } = useSettingsData();
  const refresh = useRefresh();
  const saving = useAutoSave();
  const stored = settings?.ai.monthlyCapUsd ?? 0;
  const [cap, setCap] = useState(String(stored));
  const [error, setError] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => setCap(String(stored)), [stored]);
  // Arriving from "the cap is reached", the field is ready to change.
  useEffect(() => {
    if (window.location.hash === "#cap") field.current?.focus();
  }, []);
  if (!settings) return null;
  const spent = settings.ai.spentUsd;

  function save() {
    const n = Number(cap);
    if (cap.trim() === "" || !Number.isFinite(n) || n < 0 || n > 10_000) {
      setError("The cap is an amount in dollars, such as 10.");
      return;
    }
    setError(null);
    if (n === stored) return;
    void saving
      .run(() => api.saveAi({ monthlyCapUsd: n }))
      .then(async (ok) => {
        if (!ok) setCap(String(stored));
        await reload();
        refresh();
      });
  }

  const next = shift(thisMonth(), 1);
  const below = Number(cap) < spent;
  return (
    <div className="spend-cap">
      <p className="spend-line">
        <strong>{dollars(spent)}</strong> of a{" "}
        <label className="cap-field">
          <span className="sr-only">Monthly cap in US dollars</span>$
          <input
            ref={field}
            id="cap"
            type="text"
            inputMode="decimal"
            value={cap}
            aria-invalid={error ? true : undefined}
            onChange={(e) => setCap(e.target.value)}
            onBlur={save}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                save();
              }
            }}
          />
        </label>{" "}
        cap · {monthName(thisMonth())} <Saved at={saving.savedAt} />
      </p>
      <div
        className="meter"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={stored}
        aria-valuenow={spent}
        aria-label="Spent of the cap"
      >
        <i style={{ width: `${stored > 0 ? Math.min(100, (spent / stored) * 100) : 100}%` }} />
      </div>
      <p className="muted small">Resets 1 {monthName(next, false)}.</p>
      {error && <p className="field-error">{error}</p>}
      {saving.error && <p className="field-error">{saving.error}</p>}
      {!error && below && cap.trim() !== "" && (
        <p className="field-warn">
          This is below the {dollars(spent)} already spent, so AI stops until{" "}
          {monthName(next, false)}.
        </p>
      )}
    </div>
  );
}

export function Spending() {
  const { settings } = useSettingsData();
  const [params, setParams] = useSearchParams();
  const month = params.get("month") ?? thisMonth();
  const [failedOnly, setFailedOnly] = useState(false);
  const log = useAsync(() => api.aiLog(month), `ai-log-${month}`);
  const names = new Map((settings?.ai.providers ?? []).map((p) => [p.id, p.name]));
  const go = (m: string) => setParams(m === thisMonth() ? {} : { month: m }, { replace: true });

  return (
    <section className="settings-block">
      <Cap />
      <h2>By provider</h2>
      {log.state === "failed" && <Problem reason={log.error.message} onRetry={log.retry} />}
      {log.state === "ready" && (
        <>
          {log.reloading && <Progress />}
          {log.value.byProvider.length === 0 ? (
            <p className="muted">Nothing spent in {monthName(month)}.</p>
          ) : (
            <div className="table-scroll">
              <table className="calls by-provider">
                <thead>
                  <tr>
                    <th>Provider</th>
                    <th className="num">Calls</th>
                    <th className="num">Cost</th>
                    <th>How we know</th>
                  </tr>
                </thead>
                <tbody>
                  {log.value.byProvider.map((p) => (
                    <tr key={p.provider}>
                      <td>{p.name}</td>
                      <td className="num">{p.calls}</td>
                      <td className="num">
                        {p.estimated > 0 && p.reported === 0 ? "≈ " : ""}
                        {dollars(p.usd)}
                      </td>
                      <td>
                        {[
                          p.reported > 0 && "reported by the provider",
                          p.estimated > 0 && "estimated from prices (≈)",
                          p.unknown > 0 && `${p.unknown} with no price known: not counted`,
                        ]
                          .filter(Boolean)
                          .join("; ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      <p className="muted small">
        The cap is Frontier's own. Also set a hard limit with each provider
        {(settings?.ai.providers ?? []).some((p) => AI_PROVIDER_KINDS[p.kind].billingUrl) && ": "}
        {(settings?.ai.providers ?? [])
          .filter((p) => AI_PROVIDER_KINDS[p.kind].billingUrl)
          .map((p, i) => (
            <span key={p.id}>
              {i > 0 && ", "}
              <a
                href={AI_PROVIDER_KINDS[p.kind].billingUrl!}
                target="_blank"
                rel="noreferrer noopener"
              >
                {p.name}
              </a>
            </span>
          ))}
        .
      </p>

      <h2>Calls</h2>
      <div className="log-head">
        <button type="button" className="plain" onClick={() => go(shift(month, -1))}>
          ‹ {monthName(shift(month, -1), false)}
        </button>
        <strong>{monthName(month)}</strong>
        {month < thisMonth() && (
          <button type="button" className="plain" onClick={() => go(shift(month, 1))}>
            {monthName(shift(month, 1), false)} ›
          </button>
        )}
        <label className="check">
          <input
            type="checkbox"
            checked={failedOnly}
            onChange={(e) => setFailedOnly(e.target.checked)}
          />
          <span>Failed only</span>
        </label>
      </div>
      {log.state === "loading" && <p className="muted">Loading…</p>}
      {log.state === "ready" &&
        (() => {
          const calls = log.value.calls.filter((c) => !failedOnly || !c.ok);
          if (calls.length === 0) {
            return (
              <p className="muted">
                {failedOnly
                  ? `No failed calls in ${monthName(month, false)}.`
                  : `No AI calls in ${monthName(month, false)} yet.`}
              </p>
            );
          }
          return (
            <div className="table-scroll">
              <table className="calls call-log">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>What</th>
                    <th>Model</th>
                    <th className="num">Tokens</th>
                    <th className="num">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {calls.map((c, i) => {
                    const { model } = splitModelId(c.model);
                    const kind = settings?.ai.providers.find((p) => p.id === c.provider)?.kind;
                    return (
                      <tr key={i} className={c.ok ? "" : "failed"}>
                        <td className="call-when">{when(c.at)}</td>
                        <td className="call-what">
                          <What call={c} />
                        </td>
                        <td className="call-model">
                          {model}{" "}
                          <span className="muted">
                            {names.get(c.provider) ??
                              (kind
                                ? AI_PROVIDER_KINDS[kind].label
                                : (AI_PROVIDER_KINDS[c.provider as AiProviderKind]?.label ??
                                  c.provider))}
                          </span>
                        </td>
                        <td className="num call-tokens">
                          {c.task === "art"
                            ? "picture"
                            : `${c.promptTokens.toLocaleString()} / ${c.completionTokens.toLocaleString()}`}
                        </td>
                        <td className="num call-cost">
                          <Cost call={c} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })()}
    </section>
  );
}
