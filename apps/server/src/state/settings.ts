import { join } from "node:path";
import { Settings, type SettingsInput } from "@frontier/schema";
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
}
