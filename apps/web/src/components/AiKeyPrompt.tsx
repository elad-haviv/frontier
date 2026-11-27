/**
 * The first time someone without a key reaches an AI feature (stage 27f): the explanation and the
 * field to add a key, in place, then the feature carries on with what they asked. `api.ts` opens
 * it when the server answers "no key on this device" or "the provider turned your key away", and
 * sends the same request again once the key the request needs is kept. A key for another
 * provider does not do: the dialog stays open and says which one the chosen model needs. Asks are
 * queued by provider, so two requests that race each get the key they need. Closing it leaves the
 * request failed, with the server's own words.
 */
import { AI_PROVIDER_KINDS, type AiProviderKind } from "@frontier/schema";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { setKeyPrompt, type KeyAsk } from "../api.ts";
import { KeyAsks } from "../keyAsks.ts";
import { DialogFrame } from "./Dialogs.tsx";
import { KeepKeyButton, KeyEntryFields, useKeyEntry } from "./AiKeyForm.tsx";

/** What a person needs to know before putting a key on this device. */
export function KeyExplanation() {
  return (
    <div className="ai-key-explain">
      <p>
        Frontier doesn&apos;t come with an AI account. Add a key from OpenRouter, Anthropic, OpenAI
        or Google and you pay them directly.
      </p>
      <p>
        <strong>The key is kept on this device only.</strong> Frontier&apos;s server never saves it,
        and the project&apos;s owner can&apos;t see it.
      </p>
    </div>
  );
}

const labelOf = (kind: AiProviderKind) => AI_PROVIDER_KINDS[kind].label;

function Box({
  ask,
  done,
  alsoKept,
}: {
  ask: KeyAsk;
  /** The provider whose key was kept, or null when the dialog was closed. */
  done: (kept: AiProviderKind | null) => void;
  /** A key was kept for a provider this ask does not need; others waiting may need it. */
  alsoKept: (kept: AiProviderKind) => void;
}) {
  const [other, setOther] = useState<AiProviderKind | null>(null);
  const need = ask.provider;
  const entry = useKeyEntry(need ?? "openrouter", (kind) => {
    // A key for a provider the request does not use is kept, but it does not finish the ask.
    if (need && kind !== need) {
      setOther(kind);
      alsoKept(kind);
    } else done(kind);
  });
  return (
    <DialogFrame
      title={
        ask.rejected && need
          ? `${labelOf(need)} did not accept your key`
          : `${ask.feature} runs on your own AI key`
      }
      className="ai-key-dialog"
      onCancel={() => done(null)}
      onSubmit={() => void entry.submit()}
    >
      {ask.rejected ? (
        <p className="dialog-body">
          The key on this device was turned away when {ask.feature.toLowerCase()} used it. Add a
          working one; the old key is replaced.
        </p>
      ) : (
        <KeyExplanation />
      )}
      {need && (
        <p className="ai-key-hint">
          The model chosen for this needs a {labelOf(need)} key.{" "}
          <Link to="/settings/you/ai-models" onClick={() => done(null)}>
            Change the model
          </Link>
        </p>
      )}
      {other && need && (
        <p className="ai-key-error" role="alert">
          The {labelOf(other)} key is kept, but this needs a {labelOf(need)} key. Add that one, or
          change the model.
        </p>
      )}
      <KeyEntryFields entry={entry} />
      <p className="dialog-actions">
        <button type="button" className="quiet" onClick={() => done(null)}>
          Not now
        </button>
        <KeepKeyButton entry={entry} />
      </p>
    </DialogFrame>
  );
}

/**
 * Mounted once, high in the app. One dialog at a time, for the oldest ask; asks for the same
 * provider share it, and others wait their turn (see `KeyAsks`).
 */
export function AiKeyPromptHost() {
  const asks = useRef(new KeyAsks());
  const [open, setOpen] = useState<{ id: number; ask: KeyAsk } | null>(null);
  const counter = useRef(0);

  const show = useCallback(() => {
    const first = asks.current.first();
    setOpen(first ? { id: ++counter.current, ask: first } : null);
  }, []);

  const ask = useCallback((a: KeyAsk) => {
    const answer = asks.current.add(a);
    setOpen((now) => now ?? { id: ++counter.current, ask: asks.current.first()! });
    return answer;
  }, []);
  useEffect(() => {
    setKeyPrompt(ask);
    return () => setKeyPrompt(null);
  }, [ask]);

  if (!open) return null;
  return (
    <Box
      key={open.id}
      ask={open.ask}
      alsoKept={(kind) => asks.current.kept(kind)}
      done={(kept) => {
        if (kept === null) asks.current.closed();
        else asks.current.kept(kept);
        show();
      }}
    />
  );
}
