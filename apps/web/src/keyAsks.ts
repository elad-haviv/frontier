/**
 * The asks for a key that wait for the dialog (stage 27f), kept apart from the dialog so the rules
 * can be tested: one dialog at a time, for the oldest ask; an ask is answered only by a key for the
 * provider it names (a key for another provider does not do), and asks queue per provider so two
 * requests that race each get the key they need.
 */
import type { AiProviderKind } from "@frontier/schema";
import { hasDeviceKey } from "./aiKeys.ts";
import type { KeyAsk } from "./api.ts";

interface Waiting {
  ask: KeyAsk;
  resolve: (kept: boolean) => void;
}

export class KeyAsks {
  private waiting: Waiting[] = [];

  constructor(private readonly hasKey: (kind: AiProviderKind) => boolean = hasDeviceKey) {}

  /** Adds an ask; the promise says whether a key it can use was kept. */
  add(ask: KeyAsk): Promise<boolean> {
    return new Promise((resolve) => this.waiting.push({ ask, resolve }));
  }

  /** The ask the dialog is open for: the oldest. */
  first(): KeyAsk | null {
    return this.waiting[0]?.ask ?? null;
  }

  /** Whether a key for `kept` answers `w`. */
  private answers(w: Waiting, kept: AiProviderKind): boolean {
    const need = w.ask.provider;
    if (!need) return true;
    // A key that was turned away is answered only by a new one for that provider.
    return w.ask.rejected ? kept === need : this.hasKey(need);
  }

  /** A key for `kind` was kept: the asks it answers go on, the others keep waiting. */
  kept(kind: AiProviderKind): void {
    const answered = this.waiting.filter((w) => this.answers(w, kind));
    this.waiting = this.waiting.filter((w) => !answered.includes(w));
    for (const w of answered) w.resolve(true);
  }

  /** The dialog was closed: the asks for that provider fail, and the others get their turn. */
  closed(): void {
    const first = this.waiting[0]?.ask;
    if (!first) return;
    const same = (w: Waiting) =>
      w.ask.provider === first.provider && Boolean(w.ask.rejected) === Boolean(first.rejected);
    const failed = this.waiting.filter(same);
    this.waiting = this.waiting.filter((w) => !same(w));
    for (const w of failed) w.resolve(false);
  }
}
