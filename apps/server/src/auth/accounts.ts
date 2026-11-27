import { ConfigError } from "../config.js";
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

/**
 * Records that the people store has been made, so the start of the server never makes a first
 * account again: not from the old password, and not from FRONTIER_INITIAL_PASSWORD.
 */
export async function markMigrated(settings: SettingsStore): Promise<void> {
  const now = await settings.read();
  if (!now) await settings.write({ passwordHash: "", migratedToPeople: true });
  else if (!now.migratedToPeople) await settings.update((s) => ({ ...s, migratedToPeople: true }));
}

const given = (env: Starting["env"], name: string) => env[name]?.trim() || "";

/**
 * Makes the first account when the server starts without any, and says so. It runs once: it does
 * nothing when the people store exists, and the settings keep a marker that it has existed, so a
 * people file that went missing is never answered with an account made from the old password or
 * from the environment. The server refuses to start instead, and the file is restored.
 *
 * - From before stage 27a: the settings hold a password and/or passkeys that belonged to the one
 *   "author". They become the first account, and the settings file is left as it was beside it.
 *   The name and email are the commit author's, which is the same person.
 * - A new server: `FRONTIER_INITIAL_PASSWORD`, with `FRONTIER_INITIAL_EMAIL` and
 *   `FRONTIER_INITIAL_NAME`, makes it.
 * - Otherwise nothing: the set-password command on the server makes it.
 */
export async function startAccounts(d: Starting): Promise<void> {
  if (await d.people.exists()) {
    // Servers that moved before the marker existed get it now.
    await markMigrated(d.settings);
    return;
  }
  const settings = await d.settings.read();
  if (settings?.migratedToPeople) {
    throw new ConfigError(
      `The people file ${d.people.file} is missing, although accounts were made here before. ` +
        "Starting without it would let an old password log in again. Restore it from the backup " +
        "with `npm run restore -w apps/server`, then start the server again.",
    );
  }
  // The stand-in author of a library with none configured is nobody's name or email, so the
  // account starts without them and Settings → Profile asks.
  const configured = given(d.env, "COMMIT_AUTHOR_EMAIL") !== PLACEHOLDER_AUTHOR_EMAIL;
  const author = {
    name: configured ? given(d.env, "COMMIT_AUTHOR_NAME") : "",
    email: configured ? given(d.env, "COMMIT_AUTHOR_EMAIL") : "",
  };
  // The commit author's email is not taken as the account's: it is often a no-reply address the
  // owner does not know, and a device still on the previous web build logs in with the password
  // alone. An account with no email takes exactly that, and Settings → Profile asks for one,
  // with the commit author's offered as a suggestion.

  if (settings && (settings.passwordHash !== "" || settings.passkeys.length > 0)) {
    await d.people.create({
      name: author.name,
      email: "",
      passwordHash: settings.passwordHash,
      passwordOff: settings.passwordOff,
      passkeys: settings.passkeys,
    });
    await markMigrated(d.settings);
    d.say(
      `Moved the password and passkeys into the first account${author.name ? ` (${author.name})` : ""}, ` +
        "which has no email yet: log in with the password alone, and give an email in Settings → Profile.",
    );
    return;
  }

  const initial = given(d.env, "FRONTIER_INITIAL_PASSWORD");
  if (!initial) return;
  const first = await d.people.create({
    name: given(d.env, "FRONTIER_INITIAL_NAME") || author.name,
    email: given(d.env, "FRONTIER_INITIAL_EMAIL") || author.email,
    passwordHash: await hashPassword(initial),
  });
  // The rest of the settings (AI, keep going) need their file to exist.
  await markMigrated(d.settings);
  d.say(
    `Made the first account from FRONTIER_INITIAL_PASSWORD (${first.email || first.name || "no name or email yet"}).`,
  );
}
