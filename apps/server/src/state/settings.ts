import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  AI_PROVIDER_KINDS,
  type AiProviderKind,
  Settings,
  type SettingsInput,
} from "@frontier/schema";
import type { StateFiles } from "./files.js";

export class SettingsStore {
  private readonly path: string;

  constructor(
    stateDir: string,
    private readonly files: StateFiles,
  ) {
    this.path = join(stateDir, "settings.json");
  }

  /** The stored settings, or null before a password has been set. */
  read(): Promise<Settings | null> {
    return this.files.readJson(this.path, Settings);
  }

  /** Writes the settings whole. Parts left out get their defaults, so pass what was read. */
  write(settings: SettingsInput): Promise<void> {
    return this.files.writeJson(this.path, Settings.parse(settings));
  }

  /** Changes part of the settings and keeps the rest. Refused before a password exists. */
  async update(change: (settings: Settings) => Settings): Promise<Settings> {
    const now = await this.read();
    if (!now) throw new Error("Settings cannot be changed before a password is set.");
    const next = Settings.parse(change(now));
    await this.files.writeJson(this.path, next);
    return next;
  }

  /**
   * Deletes the AI keys an earlier version stored in the settings file (stage 27f: keys now live
   * only in each person's browser), together with the provider entries and the monthly cap that
   * went with them, and leaves a one-time notice for the web app to show. Models chosen from an
   * endpoint that no longer exists are switched off. Runs at every start and does nothing once
   * the file is clean. Returns the notice made, or null when no key was stored.
   */
  async removeStoredKeys(
    now: Date = new Date(),
  ): Promise<{ at: string; providers: string[] } | null> {
    if (!existsSync(this.path)) return null;
    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(await readFile(this.path, "utf8")) as Record<string, unknown>;
    } catch {
      return null;
    }
    const ai = raw.ai as Record<string, unknown> | undefined;
    if (!ai || typeof ai !== "object") return null;
    const entries = Array.isArray(ai.providers) ? (ai.providers as Record<string, unknown>[]) : [];
    const had: string[] = [];
    if (ai.key) had.push(AI_PROVIDER_KINDS.openrouter.label);
    for (const e of entries) {
      if (!e.key) continue;
      const kind = e.kind as AiProviderKind;
      const label =
        typeof e.name === "string" ? e.name : (AI_PROVIDER_KINDS[kind]?.label ?? "Other");
      if (!had.includes(label)) had.push(label);
    }
    const legacy = "key" in ai || "providers" in ai || "monthlyCapUsd" in ai;
    const models = (ai.models ?? {}) as Record<string, unknown>;
    const orphaned = Object.entries(models).filter(
      ([, id]) => typeof id === "string" && /^custom(-\d+)?:/.test(id),
    );
    if (!legacy && orphaned.length === 0) return null;

    const rest = { ...ai };
    for (const gone of ["key", "providers", "monthlyCapUsd"]) delete rest[gone];
    const notice = had.length > 0 ? { at: now.toISOString(), providers: had } : null;
    await this.write({
      ...(raw as SettingsInput),
      ai: {
        ...rest,
        models: { ...models, ...Object.fromEntries(orphaned.map(([task]) => [task, null])) },
        ...(notice ? { keysRemoved: notice } : {}),
      },
    } as SettingsInput);
    return notice;
  }
}
