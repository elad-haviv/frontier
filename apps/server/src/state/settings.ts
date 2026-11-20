import { join } from "node:path";
import { Settings } from "@frontier/schema";
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

  write(settings: Settings): Promise<void> {
    return this.files.writeJson(this.path, settings);
  }
}
