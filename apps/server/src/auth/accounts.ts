import { PLACEHOLDER_AUTHOR_EMAIL } from "../sample.js";
import { hashPassword } from "./password.js";
import type { PeopleStore } from "../state/people.js";
import type { SettingsStore } from "../state/settings.js";

export interface Starting {
  people: PeopleStore;
  settings: SettingsStore;
  env: Record<string, string | undefined>;
  /** Called with a line that says what was made. */
  say: (message: string) => void;
}

const given = (env: Starting["env"], name: string) => env[name]?.trim() || "";

/**
 * Makes the first account when the server starts without any, and says so. It runs once, because
 * it does nothing when the people store exists.
 *
 * - From before stage 27a: the settings hold a password and/or passkeys that belonged to the one
 *   "author". They become the first account, and the settings file is left as it was beside it.
 *   The name and email are the commit author's, which is the same person.
 * - A new server: `FRONTIER_INITIAL_PASSWORD`, with `FRONTIER_INITIAL_EMAIL` and
 *   `FRONTIER_INITIAL_NAME`, makes it.
 * - Otherwise nothing: the set-password command on the server makes it.
 */
export async function startAccounts(d: Starting): Promise<void> {
  if (await d.people.exists()) return;
  const settings = await d.settings.read();
  // The stand-in author of a library with none configured is nobody's name or email, so the
  // account starts without them and Settings → Profile asks.
  const configured = given(d.env, "COMMIT_AUTHOR_EMAIL") !== PLACEHOLDER_AUTHOR_EMAIL;
  const author = {
    name: configured ? given(d.env, "COMMIT_AUTHOR_NAME") : "",
    email: configured ? given(d.env, "COMMIT_AUTHOR_EMAIL") : "",
  };

  if (settings && (settings.passwordHash !== "" || settings.passkeys.length > 0)) {
    await d.people.create({
      ...author,
      passwordHash: settings.passwordHash,
      passwordOff: settings.passwordOff,
      passkeys: settings.passkeys,
    });
    d.say("Moved the password and passkeys into the first account.");
    return;
  }

  const initial = given(d.env, "FRONTIER_INITIAL_PASSWORD");
  if (!initial) return;
  await d.people.create({
    name: given(d.env, "FRONTIER_INITIAL_NAME") || author.name,
    email: given(d.env, "FRONTIER_INITIAL_EMAIL") || author.email,
    passwordHash: await hashPassword(initial),
  });
  // The rest of the settings (AI, keep going) need their file to exist.
  if (!settings) await d.settings.write({ passwordHash: "" });
  d.say("Made the first account from FRONTIER_INITIAL_PASSWORD.");
}
