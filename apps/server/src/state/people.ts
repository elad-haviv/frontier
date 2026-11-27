import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { emailKey, PeopleFile, type Person } from "@frontier/schema";
import { ApiError } from "../errors.js";
import type { StateFiles } from "./files.js";

/**
 * An account whose address nobody confirmed may give it up to a person Google has verified it
 * for, so a mistyped or squatted address cannot keep the real owner out. Not when that would shut
 * its person out: they must have a way in that needs no address (a passkey), and the server's
 * first account (the admin) is never touched. An account linked to Google is not touched either.
 */
export const mayDisplace = (p: Person): boolean =>
  p.emailConfirmedAt === null && !p.admin && p.identities.length === 0 && p.passkeys.length > 0;

/** The account after it gave its address up: asked to add another, with no link left for the old one. */
export const displaced = (p: Person): Person => ({
  ...p,
  email: "",
  emailCode: null,
  emailPending: null,
  resetCode: null,
  emailDisplaced: true,
});

/** What a new account starts from; the rest has its defaults. */
export type NewPerson = Partial<Omit<Person, "id" | "createdAt" | "admin">>;

/**
 * Everyone who has an account, in `/data/state/people.json`. The file is part of the backup, like
 * the rest of the state folder. One server process is its only writer, and changes are made one
 * after another, so two requests cannot overwrite each other's change.
 *
 * The people are held in memory, because every request asks who is logged in. What is held is
 * checked against the file's size and time of change on each read, so the set-password command,
 * which runs as its own process and writes the same file, is seen at once, and so is a file
 * restored from the backup while the server runs.
 */
export class PeopleStore {
  /** Where the file is, for what is said when it is missing. */
  readonly file: string;
  private readonly path: string;
  private turn: Promise<unknown> = Promise.resolve();
  /** What was last read or written, and the file's stamp then; null stamp is "no file". */
  private held: { stamp: string | null; people: Person[] } | null = null;

  constructor(
    stateDir: string,
    private readonly files: StateFiles,
  ) {
    this.path = join(stateDir, "people.json");
    this.file = this.path;
  }

  /** Whether the store exists yet. Before it does, the move from "author" may still be due. */
  async exists(): Promise<boolean> {
    return (await this.stamp()) !== null;
  }

  async all(): Promise<Person[]> {
    const stamp = await this.stamp();
    if (this.held && this.held.stamp === stamp) return this.held.people;
    const people = (await this.files.readJson(this.path, PeopleFile))?.people ?? [];
    this.held = { stamp, people };
    return people;
  }

  /** Changes whenever the file does, from this process or another; null when there is no file. */
  private async stamp(): Promise<string | null> {
    try {
      const s = await stat(this.path);
      return `${s.mtimeMs}:${s.size}`;
    } catch {
      return null;
    }
  }

  /** The id of the server's first account, from what is held in memory; null before any was read. */
  adminIdSync(): string | null {
    return this.held?.people.find((p) => p.admin)?.id ?? null;
  }

  async get(id: string): Promise<Person | null> {
    return (await this.all()).find((p) => p.id === id) ?? null;
  }

  /** The person with this email, however it is typed; null for an empty one. */
  async byEmail(email: string): Promise<Person | null> {
    const key = emailKey(email);
    if (key === "") return null;
    return (await this.all()).find((p) => emailKey(p.email) === key) ?? null;
  }

  /** The person who holds the passkey with this credential id. */
  async byPasskey(credentialId: string): Promise<Person | null> {
    return (await this.all()).find((p) => p.passkeys.some((k) => k.id === credentialId)) ?? null;
  }

  /**
   * Makes an account. The first one made is the admin. Refuses an email another account uses,
   * unless `displaceUnconfirmed` says an account whose address nobody confirmed gives it up to a
   * person whose address Google verified (see `mayDisplace`); then that account is left with no
   * address, in the same write.
   */
  create(
    input: NewPerson,
    options: { displaceUnconfirmed?: boolean; onDisplaced?: (before: Person) => void } = {},
  ): Promise<Person> {
    return this.change(async (all) => {
      let people = all;
      const key = emailKey(input.email ?? "");
      const clash = key === "" ? undefined : people.find((p) => emailKey(p.email) === key);
      if (clash && options.displaceUnconfirmed && mayDisplace(clash)) {
        people = people.map((p) => (p.id === clash.id ? displaced(p) : p));
        options.onDisplaced?.(clash);
      }
      this.checkEmail(people, input.email ?? "", null);
      const person: Person = {
        passwordHash: "",
        passwordOff: false,
        sessionEpoch: 0,
        passkeys: [],
        identities: [],
        lastProject: null,
        name: "",
        email: "",
        emailConfirmedAt: null,
        emailConfirmedBy: null,
        emailCode: null,
        emailPending: null,
        resetCode: null,
        emailDisplaced: false,
        ...input,
        id: randomUUID(),
        createdAt: new Date().toISOString(),
        admin: all.length === 0,
      };
      return { people: [...people, person], result: person };
    });
  }

  /**
   * Takes an account away again. Only for undoing an account made a moment ago, when what it was
   * made for (joining a project) failed; nothing else refers to it yet. `restore` is an account
   * that gave up its address to this one (see `create`): it gets it back, as it was.
   */
  remove(id: string, restore?: Person): Promise<void> {
    return this.change(async (people) => ({
      people: people
        .filter((p) => p.id !== id)
        .map((p) =>
          restore && p.id === restore.id && p.email === "" && p.emailDisplaced ? restore : p,
        ),
      result: undefined,
    }));
  }

  /** Changes one account and keeps the rest. Returns the account as it is after. */
  update(id: string, change: (person: Person) => Person): Promise<Person> {
    return this.change(async (people) => {
      const now = people.find((p) => p.id === id);
      if (!now) throw new ApiError("unauthenticated", "Log in first.");
      const next = { ...change(now), id: now.id, admin: now.admin };
      this.checkEmail(people, next.email, id);
      return { people: people.map((p) => (p.id === id ? next : p)), result: next };
    });
  }

  private checkEmail(people: Person[], email: string, own: string | null): void {
    const key = emailKey(email);
    if (key !== "" && people.some((p) => p.id !== own && emailKey(p.email) === key)) {
      throw new ApiError("email_taken", "Another account already uses this email.");
    }
  }

  /**
   * Runs any change to the accounts, after every one before it, in one write: what the confirm
   * and reset links do, so a link is used by exactly one request and what it changes is written
   * with it. The work gets the accounts as they are at that moment.
   */
  mutate<T>(work: (people: Person[]) => { people: Person[]; result: T }): Promise<T> {
    return this.change(async (people) => work(people));
  }

  /** Runs a read-change-write after every one before it, and writes only what it returns. */
  private change<T>(
    work: (people: Person[]) => Promise<{ people: Person[]; result: T }>,
  ): Promise<T> {
    const run = this.turn.then(async () => {
      const { people, result } = await work(await this.all());
      const file = PeopleFile.parse({ version: 1, people });
      await this.files.writeJson(this.path, file);
      this.held = { stamp: await this.stamp(), people: file.people };
      return result;
    });
    // A refused change must not stop the changes behind it.
    this.turn = run.catch(() => undefined);
    return run;
  }
}
