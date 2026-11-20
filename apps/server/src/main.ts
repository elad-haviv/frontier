import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp } from "./app.js";
import { hashPassword } from "./auth/password.js";
import { ConfigError, loadConfig } from "./config.js";
import { startPolling } from "./git/poll.js";
import { applySampleMode } from "./sample.js";

async function main(): Promise<void> {
  applySampleMode(process.env);
  const config = loadConfig();
  await mkdir(join(config.dataDir, "state"), { recursive: true });
  const webDir =
    process.env["WEB_DIR"] ?? join(dirname(fileURLToPath(import.meta.url)), "../../web/dist");
  const { app, services } = await buildApp(config, { logger: true, webDir });

  // A first password can be given through the environment. It is used only while none is stored.
  const initial = process.env["FRONTIER_INITIAL_PASSWORD"]?.trim();
  if (initial && (await services.settings.read()) === null) {
    await services.settings.write({ passwordHash: await hashPassword(initial) });
    app.log.info("Stored the initial password from FRONTIER_INITIAL_PASSWORD.");
  }

  await services.git.ensureClone();
  await services.sync();
  startPolling(services.sync, (err) => app.log.error({ err }, "Timer fetch failed"));

  const port = Number(process.env["PORT"] ?? 3000);
  await app.listen({ host: "0.0.0.0", port });
}

main().catch((err: unknown) => {
  if (err instanceof ConfigError) console.error(`Frontier cannot start. ${err.message}`);
  else console.error(err);
  process.exit(1);
});
