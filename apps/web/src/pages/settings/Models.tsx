/**
 * You › AI models: one model per task, chosen through the model picker. A choice saves as it is
 * made, with "✓ Saved" and Undo. `/settings/you/ai-models/:task` opens that task's picker. The
 * choice is kept on the server and holds no secret; the models listed are those of the providers
 * this device has a key for.
 */
import type { AiProviderKind, AiTaskName, CatalogModel, ModelsResponse } from "@frontier/schema";
import { splitModelId } from "@frontier/schema";
import { useCallback, useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { api } from "../../api.ts";
import { useDeviceKeys } from "../../aiKeys.ts";
import { ModelPicker, needsPrice, type Price } from "../../components/ModelPicker.tsx";
import { useDialogs } from "../../components/Dialogs.tsx";
import { useRefresh } from "../../components/Shell.tsx";
import { ActionButton } from "../../components/ui/ActionButton.tsx";
import { useToast } from "../../components/ui/Toast.tsx";
import {
  message,
  kindLabel,
  perMillion,
  ProviderMark,
  Saved,
  TASKS,
  tokens,
  usd,
  useAutoSave,
  useSettingsData,
  useWide,
} from "./shared.tsx";

function Chip({ id, m }: { id: string; m: CatalogModel | undefined }) {
  const { model } = splitModelId(id);
  if (!m) {
    return (
      <span className="model-chip">
        <span className="model-chip-name mono">{model}</span>
      </span>
    );
  }
  return (
    <span className="model-chip">
      <ProviderMark kind={m.providerKind} size="sm" />
      <span className="model-chip-name">{m.name}</span>
      <span className="muted small">{m.providerName}</span>
      <span className="model-chip-right">
        {m.contextLength !== null && `${tokens(m.contextLength)} · `}
        {m.promptPrice !== null
          ? `${m.costReported ? "" : "≈ "}${perMillion(m.promptPrice)} in, ${perMillion(m.completionPrice)} out`
          : m.costReported
            ? "cost reported"
            : "price unknown"}
      </span>
    </span>
  );
}

function TaskRow({
  task,
  title,
  about,
  catalog,
  catalogState,
  open,
  onOpen,
  onClose,
}: {
  task: AiTaskName;
  title: string;
  about: string;
  catalog: ModelsResponse | null;
  catalogState: { loading: boolean; error: string | null; retry: () => void };
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
}) {
  const { settings, reload } = useSettingsData();
  const refresh = useRefresh();
  const toast = useToast();
  const dialogs = useDialogs();
  const wide = useWide();
  const saving = useAutoSave();
  const trying = useAutoSave();
  const [tried, setTried] = useState<{ ok: boolean; text: string; image?: string } | null>(null);
  const [style, setStyle] = useState(settings?.ai.artStyle ?? "");
  const styleSave = useAutoSave();
  const publishSave = useAutoSave();
  if (!settings) return null;
  const ai = settings.ai;
  const id = ai.models[task];
  const chosen = id ? catalog?.models.find((m) => m.id === id) : undefined;
  const { keys } = useDeviceKeys();
  const providerId = id ? splitModelId(id).provider : null;
  const listed = catalog?.providers.find((p) => p.id === providerId);
  const lacksKey = providerId !== null && !(providerId in keys);
  const gone = id && catalog && listed?.ok && !chosen;
  const recommended = catalog?.models.find(
    (m) => m.recommendedFor.includes(task) && !needsPrice(m),
  );
  const anyKey = Object.keys(keys).length > 0;

  async function choose(next: string | null, undo = true) {
    const before = id;
    onClose();
    const ok = await saving.run(() => api.saveAi({ models: { [task]: next } }));
    if (!ok) return;
    await reload();
    refresh();
    if (undo && before !== next) {
      toast({
        message: next
          ? `${title} now uses ${catalog?.models.find((m) => m.id === next)?.name ?? next}.`
          : `${title} is off.`,
        action: {
          label: "Undo",
          run: () => void choose(before, false),
        },
      });
    }
  }

  async function tryIt() {
    setTried(null);
    if (task === "art") {
      const ok = await dialogs.confirm({
        title: "Make a test picture?",
        body: "A picture costs a few cents.",
        action: "Make it",
      });
      if (!ok) return;
    }
    await trying.run(async () => {
      const r = await api.testAi({ task });
      setTried({
        ok: r.ok,
        text: `${r.message} Cost: ${usd(r.costUsd)}.`,
        ...(r.image ? { image: r.image } : {}),
      });
      await reload();
    });
  }

  return (
    <li className={`task-row ${gone ? "is-gone" : ""}`} id={`task-${task}`}>
      <div className="task-label">
        <strong>{title}</strong>
        <small>{about}</small>
      </div>
      <div className="task-choice">
        {id ? (
          <button
            type="button"
            className="model-chip-button"
            aria-expanded={open}
            onClick={open ? onClose : onOpen}
            aria-label={`Model for ${title}: ${chosen?.name ?? id}. Change`}
          >
            <Chip id={id} m={chosen} />
          </button>
        ) : !anyKey ? (
          <p className="muted">
            <Link to="/settings/device/ai-keys">Add an AI key to this device first.</Link>
          </p>
        ) : (
          <div className="task-off">
            <span>Off</span>
            {recommended && (
              <button type="button" className="quiet" onClick={() => void choose(recommended.id)}>
                Use {recommended.name}, recommended
              </button>
            )}
            <button
              type="button"
              className="plain"
              aria-expanded={open}
              onClick={open ? onClose : onOpen}
            >
              Choose a model
            </button>
          </div>
        )}
        {gone && (
          <p className="field-warn">
            Not listed by {listed?.name ?? "its provider"} any more; calls may fail. Choose another
            model.
          </p>
        )}
        {id && lacksKey && (
          <p className="field-warn">
            There is no key on this device for {kindLabel(providerId as AiProviderKind)}.{" "}
            <Link to="/settings/device/ai-keys">Add one</Link> or choose another model.
          </p>
        )}
        {id && !lacksKey && listed && !listed.ok && (
          <p className="field-warn">
            {listed.name} did not answer with the key on this device:{" "}
            <Link to="/settings/device/ai-keys">check it in AI keys</Link>.
          </p>
        )}
        {saving.error && <p className="field-error">{saving.error}</p>}
        <p className="task-actions">
          <Saved at={saving.savedAt} />
          {id && (
            <>
              <button type="button" className="plain" onClick={open ? onClose : onOpen}>
                Change
              </button>
              <ActionButton
                type="button"
                className="quiet"
                disabled={trying.busy}
                onClick={() => void tryIt()}
              >
                {trying.busy ? "Trying…" : "Try it"}
              </ActionButton>
              <button type="button" className="plain danger" onClick={() => void choose(null)}>
                Turn off
              </button>
            </>
          )}
        </p>
        {trying.error && <p className="field-error">{trying.error}</p>}
        {tried && (
          <div className={tried.ok ? "field-ok" : "field-error"} role="status">
            <p>{tried.text}</p>
            {tried.image && (
              <img src={tried.image} alt="The test picture" className="task-test-picture" />
            )}
          </div>
        )}
        {task === "art" && (
          <label className="field">
            <span>
              Style of concept art <Saved at={styleSave.savedAt} />
            </span>
            <textarea
              rows={3}
              maxLength={600}
              value={style}
              onChange={(e) => setStyle(e.target.value)}
              onBlur={() => {
                const next = style.trim();
                if (next === ai.artStyle) return;
                if (next === "") {
                  setStyle(ai.artStyle);
                  styleSave.setError("The style can't be empty.");
                  return;
                }
                void styleSave
                  .run(() => api.saveAi({ artStyle: next }))
                  .then((ok) => {
                    if (!ok) setStyle(ai.artStyle);
                    else void reload();
                  });
              }}
            />
            <em className="muted small">
              {style.length} of 600 characters. Added to every picture's description.
            </em>
            {styleSave.error && <em className="field-error">{styleSave.error}</em>}
          </label>
        )}
        {task === "extraction" && (
          <label className="check">
            <input
              type="checkbox"
              checked={ai.proposeOnPublish}
              onChange={(e) =>
                void publishSave
                  .run(() => api.saveAi({ proposeOnPublish: e.target.checked }))
                  .then(() => reload())
              }
            />
            <span>
              Propose fields for the entries of each publish <Saved at={publishSave.savedAt} />
            </span>
          </label>
        )}
        {publishSave.error && <p className="field-error">{publishSave.error}</p>}
      </div>
      {open && (
        <div className="task-picker">
          <ModelPicker
            task={task}
            title={title}
            catalog={catalog}
            loading={catalogState.loading}
            error={catalogState.error}
            onRetry={catalogState.retry}
            current={id}
            sheet={!wide}
            onChoose={(m) => void choose(m.id)}
            onPrice={async (m: CatalogModel, p: Price) => {
              await api.savePrices({ [m.id]: p });
              catalogState.retry();
              await choose(m.id);
            }}
            onTry={
              task === "art"
                ? null
                : async (typed) => {
                    const full = typed.includes(":")
                      ? typed
                      : `${catalog?.providers[0]?.id ?? "openrouter"}:${typed}`;
                    const r = await api
                      .testAi({ task, model: full })
                      .catch((err: unknown) => ({ ok: false, message: message(err), costUsd: 0 }));
                    if (r.ok) await choose(full);
                    else setTried({ ok: false, text: r.message });
                    return r.ok;
                  }
            }
            onClose={onClose}
          />
        </div>
      )}
    </li>
  );
}

export function Models() {
  const { settings } = useSettingsData();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const asked = /\/settings\/you\/ai-models\/(extraction|conversation|art)$/.exec(pathname)?.[1] as
    AiTaskName | undefined;
  const [catalog, setCatalog] = useState<ModelsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const load = useCallback(async (refresh: boolean) => {
    setLoading(true);
    try {
      setCatalog(await api.models(refresh ? { refresh: true } : {}));
      setError(null);
    } catch (err) {
      setError(message(err));
    } finally {
      setLoading(false);
    }
  }, []);
  // The lists are of the providers this device has keys for: read again when the keys change.
  const { keys } = useDeviceKeys();
  const keysSeen = JSON.stringify(keys);
  useEffect(() => void load(tick > 0), [load, tick, keysSeen]);

  // A deep link to a task scrolls to it with its picker open.
  useEffect(() => {
    if (asked) document.getElementById(`task-${asked}`)?.scrollIntoView({ block: "start" });
  }, [asked]);

  if (!settings) return null;
  const failing = catalog?.providers.filter((p) => !p.ok) ?? [];
  return (
    <section className="settings-block">
      <p className="muted">
        Each task uses one model, from any provider you have a key for on this device. A choice is
        saved as you make it.
      </p>
      {failing.map((p) => (
        <p key={p.id} className="field-warn">
          {p.error}{" "}
          <button type="button" className="plain" onClick={() => setTick(tick + 1)}>
            Retry
          </button>
        </p>
      ))}
      <ul className="task-list">
        {TASKS.map((t) => (
          <TaskRow
            key={t.task}
            {...t}
            catalog={catalog}
            catalogState={{ loading, error, retry: () => setTick((n) => n + 1) }}
            open={asked === t.task}
            onOpen={() =>
              navigate(`/settings/you/ai-models/${t.task}`, { replace: asked !== undefined })
            }
            onClose={() => navigate("/settings/you/ai-models", { replace: true })}
          />
        ))}
      </ul>
    </section>
  );
}
