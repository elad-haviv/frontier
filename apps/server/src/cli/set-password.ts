/**
 * Sets an account's password, or makes the first account. There is no sign-up page.
 *
 *   npm run set-password -w apps/server                      the admin, the first account
 *   npm run set-password -w apps/server -- you@example.com   the account with that email
 *
 * Reads the password from standard input, so it is not left in the shell history. On a server with
 * no account yet it makes the first one, and asks for its name and email too.
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { startAccounts } from "../auth/accounts.js";
import { hashPassword } from "../auth/password.js";
import { PeopleStore } from "../state/people.js";
import { StateFiles } from "../state/files.js";
import { SettingsStore } from "../state/settings.js";

const dataDir = process.env["DATA_DIR"]?.trim() || "/data";
const stateDir = join(dataDir, "state");
await mkdir(stateDir, { recursive: true });
const files = new StateFiles();
const settings = new SettingsStore(stateDir, files);
const people = new PeopleStore(stateDir, files);

// A server from before accounts: its password and passkeys become the first account first.
await startAccounts({ people, settings, env: process.env, say: (m) => console.error(m) });

const wanted = process.argv[2]?.trim();
const all = await people.all();
const person = wanted ? await people.byEmail(wanted) : (all.find((p) => p.admin) ?? null);
if (wanted && !person) {
  console.error(`There is no account with the email ${wanted}. Nothing was changed.`);
  process.exit(1);
}

const rl = createInterface({ input: process.stdin, output: process.stderr });
const ask = async (question: string) => (await rl.question(question)).trim();
let name = "";
let email = "";
if (!person) {
  name = await ask("Name of the first account: ");
  email = await ask("Email of the first account: ");
}
const password = await ask("New password (at least 12 characters): ");
rl.close();

if (password.length < 12) {
  console.error("The password is too short. Nothing was changed.");
  process.exit(1);
}

const passwordHash = await hashPassword(password);
if (person) {
  // The password is switched back on, which is the way in again after losing a passkey device.
  await people.update(person.id, (p) => ({ ...p, passwordHash, passwordOff: false }));
  console.error(`Password set for ${person.email || person.name || "the account"}.`);
} else {
  await people.create({ name, email, passwordHash });
  // The rest of the settings (AI, keep going) need their file to exist.
  if ((await settings.read()) === null) await settings.write({ passwordHash: "" });
  console.error(`Made the first account. Stored in ${join(stateDir, "people.json")}.`);
}
