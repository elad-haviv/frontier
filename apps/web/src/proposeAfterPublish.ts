/**
 * Field proposals after a publish (stage 27f). The server used to make them by itself once a
 * publish was through; it has no AI key of its own now, so the browser that published asks for
 * them, with its key, right after. Nothing here nags: with the setting off, no model chosen, or no
 * key on this device for that model's provider, it quietly does nothing (the key dialog is never
 * opened by it).
 *
 * The entries still waiting are kept on this device, per person, so a closed tab or a dropped
 * connection loses none: they are asked for on the next load that is online, with the key. Entries
 * that no longer exist, or that cannot be read as notes, are dropped. Proposals made are waiting in
 * the inbox either way.
 */
import { type AiProviderKind, splitModelId } from "@frontier/schema";
import { hasDeviceKey } from "./aiKeys.ts";
import { api } from "./api.ts";
import { readOwn, writeOwn } from "./personStorage.ts";

const WHAT = "pendingProposals";

export interface PendingStore {
  read: () => string[];
  write: (paths: string[]) => void;
}

export interface ProposeDeps {
  settings: () => Promise<{
    ai: { proposeOnPublish: boolean; models: { extraction: string | null } };
  }>;
  propose: (path: string) => Promise<{ made: number }>;
  hasKey: (kind: AiProviderKind) => boolean;
  /** Where the entries still waiting are kept; on this device, per person, unless a test says. */
  pending?: PendingStore;
}

const stored: PendingStore = {
  read: () =>
    readOwn(WHAT, (raw) =>
      Array.isArray(raw) ? raw.filter((p): p is string => typeof p === "string") : null,
    ) ?? [],
  write: (paths) => writeOwn(WHAT, paths.length > 0 ? paths : null),
};

const live: ProposeDeps = {
  settings: () => api.settings(),
  propose: (path) => api.proposeFields(path, true),
  hasKey: hasDeviceKey,
};

/** Errors after which the entry is not given up on: it is tried again another time. */
const KEEP = new Set(["offline", "unauthenticated", "ai_off", "ai_key_missing", "ai_key_rejected"]);

let working = false;

/** Asks for the proposals of what is waiting, one entry at a time; returns how many were made. */
async function work(deps: ProposeDeps): Promise<number> {
  if (working) return 0;
  working = true;
  const pending = deps.pending ?? stored;
  let made = 0;
  try {
    const { ai } = await deps.settings();
    const model = ai.models.extraction;
    if (!ai.proposeOnPublish || !model) {
      // Nothing will be proposed: no point waiting for it.
      pending.write([]);
      return 0;
    }
    const provider = splitModelId(model).provider as AiProviderKind;
    if (!deps.hasKey(provider)) return 0;
    for (;;) {
      const path = pending.read()[0];
      if (path === undefined) break;
      try {
        made += (await deps.propose(path)).made;
      } catch (err) {
        const code = (err as { code?: string }).code ?? "";
        const status = (err as { status?: number }).status;
        if (status === 0 || KEEP.has(code)) break;
        // One entry failing, as it can for one that is gone or is not a note, does not stop the
        // others, and is not asked for again.
      }
      pending.write(pending.read().filter((p) => p !== path));
    }
  } catch {
    /* settings could not be read: what is waiting stays for the next time */
  } finally {
    working = false;
  }
  return made;
}

/** Asks for proposals for the notes just published; returns how many were made. */
export async function proposeAfterPublish(
  paths: readonly string[],
  deps: ProposeDeps = live,
): Promise<number> {
  if (paths.length === 0) return 0;
  const pending = deps.pending ?? stored;
  const have = pending.read();
  pending.write([...have, ...paths.filter((p) => !have.includes(p))]);
  return work(deps);
}

/** On opening the app, online, signed in: carries on with what an earlier page left waiting. */
export async function resumeProposals(deps: ProposeDeps = live): Promise<number> {
  if ((deps.pending ?? stored).read().length === 0) return 0;
  return work(deps);
}
