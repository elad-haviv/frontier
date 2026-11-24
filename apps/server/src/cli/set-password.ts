/**
 * Sets the single account's password. There is no sign-up page.
 *
 *   npm run set-password -w apps/server
 *
 * Reads the password from standard input, so it is not left in the shell history.
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { hashPassword } from "../auth/password.js";
import { StateFiles } from "../state/files.js";
import { SettingsStore } from "../state/settings.js";

const dataDir = process.env["DATA_DIR"]?.trim() || "/data";
const stateDir = join(dataDir, "state");

const rl = createInterface({ input: process.stdin, output: process.stderr });
const password = (await rl.question("New password (at least 12 characters): ")).trim();
rl.close();

if (password.length < 12) {
  console.error("The password is too short. Nothing was changed.");
  process.exit(1);
}

await mkdir(stateDir, { recursive: true });
const store = new SettingsStore(stateDir, new StateFiles());
// Everything else in the settings is kept as it is. The password is switched back on, which is
// the way in again after losing a passkey device.
await store.write({
  ...(await store.read()),
  passwordHash: await hashPassword(password),
  passwordOff: false,
});
console.error(`Password set. Stored in ${join(stateDir, "settings.json")}.`);
