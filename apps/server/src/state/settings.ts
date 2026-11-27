import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  AI_PROVIDER_KINDS,
  type AiProviderKind,
  PersonSettings,
  PersonSettingsFile,
  Settings,
  type SettingsInput,
} from "@frontier/schema";
import { requestPerson } from "../ai/keyring.js";
import type { StateFiles } from "./files.js";

/** Whether a person is the server's admin; the store asks it to give the admin the old values. */
export type IsAdmin = (personId: string) => Promise<boolean>;

export class SettingsStore {
  private readonly path: string;
  private readonly personPath: string;
  /** Changes to the one file are made one after another, so two requests cannot lose each other's. */
  private turn: Promise<unknown> = Promise.resolve();

  constructor(
    stateDir: string,
    private readonly files: StateFiles,
    private readonly isAdmin: IsAdmin = async () => false,
  ) {
    this.path = join(stateDir, "settings.json");
    this.personPath = join(stateDir, "person-settings.json");
  }

  /** Runs changes to the settings files one after another. */
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const run = this.turn.then(work);
    this.turn = run.catch(() => undefined);
    return run;
  }

  /**
   * One person's settings: models, prices, art style, propose-on-publish and Keep going rules.
   * Someone with nothing saved has the defaults, except the admin, whose values are the ones the
   * server's settings file held before settings were per person.
   */
  async ofPerson(personId: string): Promise<PersonSettings> {
    const file = (await this.files.readJson(this.personPath, PersonSettingsFile)) ?? { people: {} };
    const own = file.people[personId];
    if (own) return own;
    if (await this.isAdmin(personId)) {
      const old = await this.read();
      if (old) {
        return PersonSettings.parse({
          ai: {
            models: old.ai.models,
            modelPrices: old.ai.modelPrices,
            artStyle: old.ai.artStyle,
            proposeOnPublish: old.ai.proposeOnPublish,
          },
          keepGoing: old.keepGoing,
        });
      }
    }
    return PersonSettings.parse({});
  }

  /**
   * The settings of the person whose request is being served, for the code deep in a service that
   * has no request to hand. Outside a request nobody is asking, so the defaults apply.
   */
  async current(): Promise<PersonSettings> {
    const id = requestPerson();
    return id ? this.ofPerson(id) : PersonSettings.parse({});
  }

  /** Changes one person's settings and keeps the rest, the other people's included. */
  updatePerson(
    personId: string,
    change: (settings: PersonSettings) => PersonSettings,
  ): Promise<PersonSettings> {
    return this.serial(async () => {
      const next = PersonSettings.parse(change(await this.ofPerson(personId)));
      const file = (await this.files.readJson(this.personPath, PersonSettingsFile)) ?? {
        people: {},
      };
      await this.files.writeJson(
        this.personPath,
        PersonSettingsFile.parse({ people: { ...file.people, [personId]: next } }),
      );
      return next;
    });
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
  update(change: (settings: Settings) => Settings): Promise<Settings> {
    return this.serial(async () => {
      const now = await this.read();
      if (!now) throw new Error("Settings cannot be changed before a password is set.");
      const next = Settings.parse(change(now));
      await this.files.writeJson(this.path, next);
      return next;
    });
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
    /** Provider key variables set in the environment (not read any more), told once. */
    environment: string[] = [],
  ): Promise<{ at: string; providers: string[]; environment: string[] } | null> {
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
    const newEnv = environment.length > 0 && ai.envKeysNoticed !== true;
    if (!legacy && orphaned.length === 0 && !newEnv) return null;

    const rest = { ...ai };
    for (const gone of ["key", "providers", "monthlyCapUsd"]) delete rest[gone];
    const earlier = ai.keysRemoved as { at: string; providers: string[] } | null | undefined;
    const made =
      had.length > 0 || newEnv
        ? {
            at: now.toISOString(),
            providers: had,
            environment: newEnv ? environment : [],
          }
        : null;
    // A notice nobody has cleared yet keeps its time, and gains what is new.
    const notice =
      made && earlier && typeof earlier.at === "string"
        ? {
            ...made,
            at: earlier.at,
            providers: [...new Set([...earlier.providers, ...made.providers])],
          }
        : made;
    await this.write({
      ...(raw as SettingsInput),
      ai: {
        ...rest,
        models: { ...models, ...Object.fromEntries(orphaned.map(([task]) => [task, null])) },
        ...(notice ? { keysRemoved: notice } : {}),
        ...(newEnv ? { envKeysNoticed: true } : {}),
      },
    } as SettingsInput);
    return notice;
  }
}
