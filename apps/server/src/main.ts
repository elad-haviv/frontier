import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp } from "./app.js";
import { startAccounts } from "./auth/accounts.js";
import { ConfigError, loadConfig } from "./config.js";
import { claimForAdmin } from "./projects/guard.js";
import { applyLibraryMode } from "./sample.js";

async function main(): Promise<void> {
  applyLibraryMode(process.env);
  const config = loadConfig();
  await mkdir(join(config.dataDir, "state"), { recursive: true });
  const webDir =
    process.env["WEB_DIR"] ?? join(dirname(fileURLToPath(import.meta.url)), "../../web/dist");
  const { app, services } = await buildApp(config, { logger: true, webDir });

  // The first account: moved from the one password and passkeys of earlier versions, or made
  // from FRONTIER_INITIAL_PASSWORD. Only while there is no account.
  await startAccounts({
    people: services.server.people,
    settings: services.settings,
    env: process.env,
    say: (message) => app.log.info(message),
  });

  // A server from before accounts has its first account only now; it owns the first project.
  const admin = (await services.server.people.all()).find((p) => p.admin);
  if (admin) await claimForAdmin(services.server, admin);

  // Clones the library when it is new, reads it, starts the nightly backup, and for a GitHub
  // library the timer fetch. Projects made since are brought up when first used.
  await services.bringUp();

  const port = Number(process.env["PORT"] ?? 3000);
  await app.listen({ host: "0.0.0.0", port });
}

main().catch((err: unknown) => {
  if (err instanceof ConfigError) console.error(`Frontier cannot start. ${err.message}`);
  else console.error(err);
  process.exit(1);
});
