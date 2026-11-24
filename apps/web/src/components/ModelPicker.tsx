/**
 * Choosing a model for a task (stage 18): a combobox over the models of every connected provider,
 * grouped by provider, with type-ahead that forgives a missing letter, filters, and the details of
 * the model under the highlight. On a phone it is a full-height sheet, and the details open from
 * each row's ⓘ. ↑ and ↓ move, Enter picks, Esc closes and changes nothing.
 */
import type { AiTaskName, CatalogModel, ModelsResponse } from "@frontier/schema";
import { Info, Search } from "lucide-react";
import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { Icon } from "./ui/Icon.tsx";
import { IconButton } from "./ui/IconButton.tsx";
import "./ModelPicker.css";

export interface Price {
  promptPrice: number;
  completionPrice: number;
}

/** Where each letter of `query` is found in order in `text`, or null; a run of letters scores higher. */
export function fuzzy(query: string, text: string): { score: number; at: number[] } | null {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (q === "") return { score: 0, at: [] };
  const direct = t.indexOf(q);
  if (direct >= 0) {
    return { score: 100 - direct + (direct === 0 ? 50 : 0), at: [...q].map((_, i) => direct + i) };
  }
  const at: number[] = [];
  let from = 0;
  let score = 0;
  for (const ch of q) {
    const i = t.indexOf(ch, from);
    if (i < 0) return null;
    score += i === from ? 3 : 1;
    at.push(i);
    from = i + 1;
  }
  return { score, at };
}

/** Whether every word of the query is found in the model's name, id or provider. */
export function matches(
  query: string,
  m: CatalogModel,
): { score: number; inName: number[] } | null {
  const words = query.trim().split(/\s+/).filter(Boolean);
  let score = 0;
  let inName: number[] = [];
  for (const w of words) {
    const byName = fuzzy(w, m.name);
    const byId = fuzzy(w, m.model);
    const byProvider = fuzzy(w, m.providerName);
    const best = [byName, byId, byProvider]
      .filter((x) => x !== null)
      .sort((a, b) => b!.score - a!.score)[0];
    if (!best) return null;
    score += best.score;
    if (byName) inName = [...inName, ...byName.at];
  }
  return { score, inName };
}

function Highlight({ text, at }: { text: string; at: number[] }) {
  if (at.length === 0) return <>{text}</>;
  const set = new Set(at);
  const out: ReactNode[] = [];
  let run = "";
  let marked = false;
  const flush = (i: number) => {
    if (run) out.push(marked ? <mark key={i}>{run}</mark> : run);
    run = "";
  };
  [...text].forEach((ch, i) => {
    const m = set.has(i);
    if (m !== marked) {
      flush(i);
      marked = m;
    }
    run += ch;
  });
  flush(text.length);
  return <>{out}</>;
}

const price = (n: number | null) =>
  n === null ? "?" : n === 0 ? "free" : `$${n >= 10 ? n.toFixed(0) : Math.round(n * 100) / 100}`;

const size = (n: number | null) =>
  n === null
    ? null
    : n >= 1_000_000
      ? `${Math.round(n / 100_000) / 10}M`.replace(".0M", "M")
      : `${Math.round(n / 1000)}K`;

/** What a model lacks for a task, in words, or null when it can do it. */
export function whyNot(task: AiTaskName, m: CatalogModel): string | null {
  if (m.suits[task] !== "no") return null;
  return task === "art"
    ? "makes no pictures, which concept art needs"
    : `can't give fixed-form answers, which ${task === "extraction" ? "proposing fields" : "lore conversations"} need`;
}

/** Whether choosing it needs a price typed first: its cost is neither reported nor priced. */
export const needsPrice = (m: CatalogModel) =>
  !m.costReported && (m.promptPrice === null || m.completionPrice === null);

const TASK_WORDS: Record<AiTaskName, string> = {
  extraction: "proposing fields",
  conversation: "a typical lore question",
  art: "a picture",
};

function Details({
  m,
  task,
  typical,
  capUsd,
  onUse,
  onPrice,
  inUse,
}: {
  m: CatalogModel;
  task: AiTaskName;
  typical: ModelsResponse["typical"];
  capUsd: number;
  onUse: () => void;
  onPrice: (p: Price) => Promise<void>;
  inUse: boolean;
}) {
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const t = typical[task] ?? { promptTokens: 0, completionTokens: 0 };
  const each =
    m.promptPrice !== null && m.completionPrice !== null && t.promptTokens + t.completionTokens > 0
      ? (t.promptTokens * m.promptPrice + t.completionTokens * m.completionPrice) / 1e6
      : null;
  const why = whyNot(task, m);
  const reads = ["text", ...(m.abilities.imagesIn ? ["images"] : [])].join(" and ");
  const answers = [
    m.abilities.structuredOutput
      ? "fixed-form answers"
      : m.abilities.structuredOutput === false
        ? "free text only"
        : null,
    m.abilities.imageOut ? "pictures" : null,
  ].filter(Boolean);
  const priceNeeded = needsPrice(m);

  async function savePrice() {
    const p = Number(input);
    const c = Number(output);
    if (
      !Number.isFinite(p) ||
      !Number.isFinite(c) ||
      p < 0 ||
      c < 0 ||
      input === "" ||
      output === ""
    ) {
      setError(
        "Prices are amounts in dollars per million tokens, such as 3 and 15. 0 is fine for a free model.",
      );
      return;
    }
    setError(null);
    await onPrice({ promptPrice: p, completionPrice: c });
  }

  return (
    <div className="mp-details" aria-live="polite">
      <h3>{m.name}</h3>
      <p className="muted small">
        {m.providerName} · <span className="mono">{m.model}</span>
      </p>
      {m.description && <p className="mp-description">{m.description}</p>}
      <dl>
        <dt>Price</dt>
        <dd>
          {m.promptPrice === null
            ? "Not known"
            : `${price(m.promptPrice)} in, ${price(m.completionPrice)} out per million tokens`}
          {m.priceFrom === "openrouter" && <span className="muted"> (OpenRouter's list)</span>}
          {m.priceFrom === "author" && <span className="muted"> (yours)</span>}
        </dd>
        {m.contextLength !== null && (
          <>
            <dt>Context</dt>
            <dd>
              {size(m.contextLength)} tokens
              {m.maxOutput !== null && `, up to ${size(m.maxOutput)} out`}
            </dd>
          </>
        )}
        <dt>Reads</dt>
        <dd>{reads}</dd>
        <dt>Answers</dt>
        <dd>{answers.length ? answers.join(" and ") : "not known"}</dd>
        {m.abilities.reasoning && (
          <>
            <dt>Thinks</dt>
            <dd>Reasons before it answers</dd>
          </>
        )}
        <dt>Cost</dt>
        <dd>
          {m.costReported
            ? `${m.providerName} reports each call's cost.`
            : "Estimated from the price and the tokens used (≈)."}
        </dd>
      </dl>
      {!m.checked && (
        <p className="mp-warn">
          Details unknown: no list says what this model can do. Use Try it after choosing.
        </p>
      )}
      {each !== null && task !== "art" && (
        <p className="mp-estimate">
          {task === "conversation" ? "A typical lore question" : "Proposing fields for an entry"}{" "}
          here sends about {t.promptTokens.toLocaleString()} tokens and gets{" "}
          {t.completionTokens.toLocaleString()} back: about{" "}
          {each < 0.01 ? `${(each * 100).toFixed(2)}¢` : `$${each.toFixed(2)}`} each.
          {each > 0 &&
            capUsd > 0 &&
            ` Your cap of $${capUsd.toFixed(0)} covers about ${Math.floor(capUsd / each).toLocaleString()}.`}
        </p>
      )}
      {m.recommendedFor.includes(task) && (
        <p className="muted small">Frontier's pick for {TASK_WORDS[task]}, reviewed 2026-11.</p>
      )}
      {why ? (
        <p className="mp-warn">This model {why}.</p>
      ) : priceNeeded ? (
        <form
          className="mp-price"
          onSubmit={(e) => {
            e.preventDefault();
            void savePrice();
          }}
        >
          <p>
            No price is known for this model, so its cost could not count against your cap. Type its
            price to choose it.
          </p>
          <div className="mp-price-row">
            <label>
              <span>In, $ per million</span>
              <input inputMode="decimal" value={input} onChange={(e) => setInput(e.target.value)} />
            </label>
            <label>
              <span>Out, $ per million</span>
              <input
                inputMode="decimal"
                value={output}
                onChange={(e) => setOutput(e.target.value)}
              />
            </label>
          </div>
          {error && <p className="field-error">{error}</p>}
          <button type="submit" className="primary">
            Save the price and use it
          </button>
        </form>
      ) : (
        <button type="button" className="primary" onClick={onUse} disabled={inUse}>
          {inUse ? "In use" : "Use this model"}
        </button>
      )}
    </div>
  );
}

type Sort = "recommended" | "price" | "name";

export function ModelPicker({
  task,
  title,
  catalog,
  loading,
  error,
  onRetry,
  current,
  capUsd,
  sheet,
  onChoose,
  onPrice,
  onTry,
  onClose,
}: {
  task: AiTaskName;
  /** The task's name, the sheet's title. */
  title: string;
  catalog: ModelsResponse | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  current: string | null;
  capUsd: number;
  /** Drawn as a full-height sheet (a phone) rather than a panel. */
  sheet: boolean;
  onChoose: (m: CatalogModel) => void;
  onPrice: (m: CatalogModel, p: Price) => Promise<void>;
  /** Tries an id that is not listed; resolves true when it answered. */
  onTry: ((id: string) => Promise<boolean>) | null;
  onClose: () => void;
}) {
  const ids = useId();
  const listId = `${ids}-list`;
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [fits, setFits] = useState(true);
  const [images, setImages] = useState(false);
  const [provider, setProvider] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>("recommended");
  const [active, setActive] = useState<string | null>(current);
  const [info, setInfo] = useState<string | null>(null);
  const [trying, setTrying] = useState<string | null>(null);

  useEffect(() => input.current?.focus(), []);

  const providers = catalog?.providers ?? [];
  const all = catalog?.models ?? [];

  const found = useMemo(() => {
    const out: { m: CatalogModel; score: number; at: number[] }[] = [];
    for (const m of all) {
      if (provider && m.provider !== provider) continue;
      if (images && !m.abilities.imagesIn) continue;
      const hit = matches(query, m);
      if (!hit) continue;
      out.push({ m, score: hit.score, at: hit.inName });
    }
    const rank = (x: { m: CatalogModel; score: number }) =>
      (x.m.recommendedFor.includes(task) ? 1000 : 0) + (x.m.id === current ? 500 : 0) + x.score;
    out.sort((a, b) => {
      if (sort === "price") {
        const pa = a.m.promptPrice ?? Infinity;
        const pb = b.m.promptPrice ?? Infinity;
        return pa - pb || a.m.name.localeCompare(b.m.name);
      }
      if (sort === "name") return a.m.name.localeCompare(b.m.name);
      return query
        ? b.score - a.score || rank(b) - rank(a)
        : rank(b) - rank(a) || a.m.name.localeCompare(b.m.name);
    });
    return out;
  }, [all, provider, images, query, sort, task, current]);

  const shown = fits ? found.filter((x) => x.m.suits[task] !== "no") : found;
  const hidden = found.length - shown.length;
  // Grouped by provider, in the providers' order.
  const groups = providers
    .filter((p) => !provider || p.id === provider)
    .map((p) => ({ p, items: shown.filter((x) => x.m.provider === p.id) }));
  const order = groups
    .flatMap((g) => g.items.map((x) => x.m))
    .filter((m) => whyNot(task, m) === null);
  const activeModel = all.find((m) => m.id === active) ?? order[0] ?? null;
  const optionId = (id: string) => `${ids}-o-${id.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
  const typed = query.trim();
  // An exact name that is not listed, such as "vendor/model": offered when it looks like one.
  const unlisted =
    onTry !== null &&
    typed !== "" &&
    !/\s/.test(typed) &&
    (/[/:]/.test(typed) || shown.length === 0) &&
    !all.some((m) => m.id === typed || m.model === typed);

  function move(by: number) {
    if (order.length === 0) return;
    const i = order.findIndex((m) => m.id === activeModel?.id);
    const next = order[Math.max(0, Math.min(order.length - 1, i < 0 ? 0 : i + by))]!;
    setActive(next.id);
    document.getElementById(optionId(next.id))?.scrollIntoView({ block: "nearest" });
  }

  function pick(m: CatalogModel) {
    if (whyNot(task, m)) return;
    if (needsPrice(m)) {
      // The price is typed in the details first.
      setActive(m.id);
      setInfo(m.id);
      return;
    }
    onChoose(m);
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      move(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      move(-1);
    } else if (e.key === "Home" && e.ctrlKey) {
      move(-order.length);
    } else if (e.key === "End" && e.ctrlKey) {
      move(order.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeModel) pick(activeModel);
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (info) setInfo(null);
      else onClose();
    }
  }

  const detailsFor = sheet ? all.find((m) => m.id === info) : activeModel;
  const filterChip = (on: boolean, label: string, toggle: () => void) => (
    <button
      type="button"
      className={`mp-chip ${on ? "on" : ""}`}
      aria-pressed={on}
      onClick={toggle}
    >
      {label}
    </button>
  );

  return (
    <div
      className={`model-picker ${sheet ? "is-sheet" : "is-panel"}`}
      role={sheet ? "dialog" : undefined}
      aria-modal={sheet ? true : undefined}
      aria-label={sheet ? `Model for ${title}` : undefined}
      onKeyDown={onKey}
    >
      {sheet && (
        <div className="mp-sheet-head">
          <strong>{title}</strong>
          <button type="button" className="plain" onClick={onClose}>
            Cancel
          </button>
        </div>
      )}
      <div className="mp-search">
        <Icon icon={Search} size="sm" />
        <input
          ref={input}
          type="text"
          role="combobox"
          aria-label={`Find a model for ${title}`}
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeModel ? optionId(activeModel.id) : undefined}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          placeholder="Search models"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(null);
          }}
        />
        {!sheet && (
          <button type="button" className="plain" onClick={onClose}>
            Close
          </button>
        )}
      </div>
      <div className="mp-filters">
        {filterChip(fits, "Fits this task", () => setFits(!fits))}
        {task !== "art" && filterChip(images, "Reads images", () => setImages(!images))}
        {providers.length > 1 &&
          providers.map((p) => (
            <span key={p.id}>
              {filterChip(provider === p.id, p.name, () =>
                setProvider(provider === p.id ? null : p.id),
              )}
            </span>
          ))}
        <label className="mp-sort">
          <span>Sort</span>
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            <option value="recommended">Recommended</option>
            <option value="price">Price</option>
            <option value="name">Name</option>
          </select>
        </label>
      </div>
      <div className="mp-body">
        <div className="mp-list" id={listId} role="listbox" aria-label={`Models for ${title}`}>
          {loading && !catalog && (
            <div className="mp-skeleton" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
          )}
          {loading && !catalog && <p className="muted mp-pad">Loading the models…</p>}
          {error && (
            <p className="field-error mp-pad">
              {error}{" "}
              <button type="button" className="plain" onClick={onRetry}>
                Retry
              </button>
            </p>
          )}
          {groups.map(({ p, items }) => (
            <div key={p.id} role="group" aria-labelledby={`${ids}-g-${p.id}`}>
              <div className="mp-group" id={`${ids}-g-${p.id}`} role="presentation">
                {p.name}
                {p.ok ? (
                  <span className="muted">
                    {" "}
                    · {items.length} of {p.count}
                    {items.length === 0 && task === "art" && " · no image models"}
                  </span>
                ) : (
                  <span className="problem">
                    {" "}
                    ·{" "}
                    {p.error?.includes("(401)") || p.error?.includes("(403)")
                      ? "key refused, fix it to list its models"
                      : "couldn't fetch its model list"}
                  </span>
                )}
              </div>
              {items.map(({ m, at }) => {
                const why = whyNot(task, m);
                const on = activeModel?.id === m.id;
                return (
                  <div
                    key={m.id}
                    id={optionId(m.id)}
                    role="option"
                    aria-selected={on}
                    aria-disabled={why ? true : undefined}
                    className={`mp-option ${on ? "active" : ""} ${why ? "unfit" : ""} ${m.id === current ? "current" : ""}`}
                    onMouseMove={() => !why && active !== m.id && setActive(m.id)}
                    onClick={() => pick(m)}
                  >
                    <span className="mp-name">
                      <Highlight text={m.name} at={at} />
                      {m.id === current && <span className="muted"> · in use</span>}
                    </span>
                    <span className="mp-price">
                      {m.promptPrice === null && !m.costReported
                        ? "price unknown"
                        : m.promptPrice === null
                          ? ""
                          : `${m.costReported ? "" : "≈ "}${price(m.promptPrice)} / ${price(m.completionPrice)}`}
                    </span>
                    <span className="mp-tags">
                      {m.recommendedFor.includes(task) && (
                        <span className="tag rec">Recommended</span>
                      )}
                      {m.contextLength !== null && (
                        <span className="tag">{size(m.contextLength)} context</span>
                      )}
                      {m.abilities.imagesIn && <span className="tag">reads images</span>}
                      {m.abilities.reasoning && <span className="tag">reasoning</span>}
                      {!m.costReported && m.promptPrice !== null && (
                        <span className="tag">cost estimated</span>
                      )}
                      {needsPrice(m) && !why && <span className="tag need">needs a price</span>}
                      {!m.checked && <span className="tag">not checked</span>}
                      {why && <span className="mp-why">{why}</span>}
                    </span>
                    {sheet && (
                      <IconButton
                        label={`Details of ${m.name}`}
                        icon={Info}
                        size="sm"
                        className="mp-info"
                        onClick={(e) => {
                          e.stopPropagation();
                          setInfo(m.id);
                        }}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          ))}
          {catalog && shown.length === 0 && !unlisted && (
            <p className="muted mp-pad">
              {providers.length === 0 ? "No provider is connected." : "No model matches."}
            </p>
          )}
          {unlisted && (
            <div className="mp-pad">
              <button
                type="button"
                className="plain"
                disabled={trying !== null}
                onClick={async () => {
                  setTrying(typed);
                  await onTry!(typed);
                  setTrying(null);
                }}
              >
                {trying ? `Trying ${typed}…` : `Try "${typed}" as a model name`}
              </button>
              <p className="muted small">It is chosen only if it answers.</p>
            </div>
          )}
          {fits && hidden > 0 && (
            <p className="mp-more">
              {hidden} more {query ? `match "${query}" but` : ""}{" "}
              {task === "art"
                ? "make no pictures, which concept art needs"
                : "can't give fixed-form answers, which this task needs"}
              .{" "}
              <button type="button" className="plain" onClick={() => setFits(false)}>
                Show them
              </button>
            </p>
          )}
        </div>
        {!sheet && detailsFor && catalog && (
          <Details
            m={detailsFor}
            task={task}
            typical={catalog.typical}
            capUsd={capUsd}
            inUse={detailsFor.id === current}
            onUse={() => pick(detailsFor)}
            onPrice={(p) => onPrice(detailsFor, p)}
          />
        )}
      </div>
      {sheet && detailsFor && catalog && (
        <div
          className="mp-details-sheet"
          role="dialog"
          aria-label={`Details of ${detailsFor.name}`}
        >
          <div className="mp-sheet-head">
            <button type="button" className="plain" onClick={() => setInfo(null)}>
              Back
            </button>
          </div>
          <Details
            m={detailsFor}
            task={task}
            typical={catalog.typical}
            capUsd={capUsd}
            inUse={detailsFor.id === current}
            onUse={() => pick(detailsFor)}
            onPrice={(p) => onPrice(detailsFor, p)}
          />
        </div>
      )}
    </div>
  );
}
