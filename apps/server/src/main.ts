import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { buildApp } from "./app.js";
import { ConfigError, loadConfig } from "./config.js";
import { startPolling } from "./git/poll.js";

async function main(): Promise<void> {
  const config = loadConfig();
  await mkdir(join(config.dataDir, "state"), { recursive: true });
  const { app, services } = await buildApp(config, { logger: true });

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
