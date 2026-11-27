import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp } from "./app.js";
import { startAccounts } from "./auth/accounts.js";
import { ConfigError, loadConfig } from "./config.js";
import { startPolling } from "./git/poll.js";
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

  await services.git.ensureClone();
  await services.sync();
  services.backup.startNightly();
  // Only a library that others write to has anything new to fetch.
  if (config.library === "github") {
    startPolling(services.sync, (err) => app.log.error({ err }, "Timer fetch failed"));
  }

  const port = Number(process.env["PORT"] ?? 3000);
  await app.listen({ host: "0.0.0.0", port });
}

main().catch((err: unknown) => {
  if (err instanceof ConfigError) console.error(`Frontier cannot start. ${err.message}`);
  else console.error(err);
  process.exit(1);
});
