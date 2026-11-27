/**
 * Field proposals after a publish (stage 27f). The server used to make them by itself once a
 * publish was through; it has no AI key of its own now, so the browser that published asks for
 * them, with its key, right after. Nothing here nags: with the setting off, no model chosen, or no
 * key on this device for that model's provider, it quietly does nothing, and it does nothing if
 * the page is closed first. Proposals made are waiting in the inbox either way.
 */
import { type AiProviderKind, splitModelId } from "@frontier/schema";
import { hasDeviceKey } from "./aiKeys.ts";
import { api } from "./api.ts";

export interface ProposeDeps {
  settings: () => Promise<{
    ai: { proposeOnPublish: boolean; models: { extraction: string | null } };
  }>;
  propose: (path: string) => Promise<{ made: number }>;
  hasKey: (kind: AiProviderKind) => boolean;
}

const live: ProposeDeps = {
  settings: () => api.settings(),
  propose: (path) => api.proposeFields(path),
  hasKey: hasDeviceKey,
};

/** Asks for proposals for the notes just published; returns how many were made. */
export async function proposeAfterPublish(
  paths: readonly string[],
  deps: ProposeDeps = live,
): Promise<number> {
  if (paths.length === 0) return 0;
  let made = 0;
  try {
    const { ai } = await deps.settings();
    const model = ai.models.extraction;
    if (!ai.proposeOnPublish || !model) return 0;
    const provider = splitModelId(model).provider as AiProviderKind;
    if (!deps.hasKey(provider)) return 0;
    for (const path of paths) {
      // One entry failing, as it can for one that is not a note, does not stop the others.
      made += await deps.propose(path).then(
        (r) => r.made,
        () => 0,
      );
    }
  } catch {
    /* settings could not be read: nothing is proposed */
  }
  return made;
}
