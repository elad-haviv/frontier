import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { emailKey, PeopleFile, type Person } from "@frontier/schema";
import { ApiError } from "../errors.js";
import type { StateFiles } from "./files.js";

/** What a new account starts from; the rest has its defaults. */
export type NewPerson = Partial<Omit<Person, "id" | "createdAt" | "admin">>;

/**
 * Everyone who has an account, in `/data/state/people.json`. The file is part of the backup, like
 * the rest of the state folder. One server process is its only writer, and changes are made one
 * after another, so two requests cannot overwrite each other's change.
 */
export class PeopleStore {
  private readonly path: string;
  private turn: Promise<unknown> = Promise.resolve();

  constructor(
    stateDir: string,
    private readonly files: StateFiles,
  ) {
    this.path = join(stateDir, "people.json");
  }

  /** Whether the store exists yet. Before it does, the move from "author" may still be due. */
  async exists(): Promise<boolean> {
    return (await this.files.readJson(this.path, PeopleFile)) !== null;
  }

  async all(): Promise<Person[]> {
    return (await this.files.readJson(this.path, PeopleFile))?.people ?? [];
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

  /** Makes an account. The first one made is the admin. Refuses an email another account uses. */
  create(input: NewPerson): Promise<Person> {
    return this.change(async (people) => {
      this.checkEmail(people, input.email ?? "", null);
      const person: Person = {
        passwordHash: "",
        passwordOff: false,
        passkeys: [],
        identities: [],
        name: "",
        email: "",
        ...input,
        id: randomUUID(),
        createdAt: new Date().toISOString(),
        admin: people.length === 0,
      };
      return { people: [...people, person], result: person };
    });
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

  /** Runs a read-change-write after every one before it, and writes only what it returns. */
  private change<T>(
    work: (people: Person[]) => Promise<{ people: Person[]; result: T }>,
  ): Promise<T> {
    const run = this.turn.then(async () => {
      const { people, result } = await work(await this.all());
      await this.files.writeJson(this.path, PeopleFile.parse({ version: 1, people }));
      return result;
    });
    // A refused change must not stop the changes behind it.
    this.turn = run.catch(() => undefined);
    return run;
  }
}
