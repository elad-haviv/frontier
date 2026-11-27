/**
 * The first time someone without a key reaches an AI feature (stage 27f): the explanation and the
 * field to add a key, in place, then the feature carries on with what they asked. `api.ts` opens
 * it when the server answers "no key on this device", and sends the same request again once a key
 * is kept. Closing it leaves the request failed, with the server's own words.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { setKeyPrompt, type KeyAsk } from "../api.ts";
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

function Box({ ask, done }: { ask: KeyAsk; done: (kept: boolean) => void }) {
  const entry = useKeyEntry(ask.provider ?? "openrouter", () => done(true));
  return (
    <DialogFrame
      title={`${ask.feature} runs on your own AI key`}
      className="ai-key-dialog"
      onCancel={() => done(false)}
      onSubmit={() => void entry.submit()}
    >
      <KeyExplanation />
      <KeyEntryFields entry={entry} />
      <p className="dialog-actions">
        <button type="button" className="quiet" onClick={() => done(false)}>
          Not now
        </button>
        <KeepKeyButton entry={entry} />
      </p>
    </DialogFrame>
  );
}

/** Mounted once, high in the app. Concurrent requests that lack a key share one dialog. */
export function AiKeyPromptHost() {
  const [open, setOpen] = useState<{ id: number; ask: KeyAsk } | null>(null);
  const waiting = useRef<((kept: boolean) => void)[]>([]);
  const counter = useRef(0);

  const ask = useCallback(
    (a: KeyAsk) =>
      new Promise<boolean>((resolve) => {
        waiting.current.push(resolve);
        setOpen((now) => now ?? { id: ++counter.current, ask: a });
      }),
    [],
  );
  useEffect(() => {
    setKeyPrompt(ask);
    return () => setKeyPrompt(null);
  }, [ask]);

  if (!open) return null;
  return (
    <Box
      key={open.id}
      ask={open.ask}
      done={(kept) => {
        const all = waiting.current;
        waiting.current = [];
        setOpen(null);
        for (const resolve of all) resolve(kept);
      }}
    />
  );
}
