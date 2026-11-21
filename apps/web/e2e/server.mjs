// Starts the built server on the sample vault, in a data folder that is emptied first.
import { Buffer } from "node:buffer";
import { rmSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, "..", "..", "..", ".e2e-data");
rmSync(dataDir, { recursive: true, force: true });

Object.assign(process.env, {
  FRONTIER_SAMPLE_VAULT: "1",
  DATA_DIR: dataDir,
  PUBLIC_URL: `http://localhost:${process.env.PORT}`,
  SESSION_KEY: Buffer.alloc(32, 9).toString("base64"),
  FRONTIER_INITIAL_PASSWORD: "browser-test-password",
  ICON_FOLDER: "99 Appendices/Icons",
});

// A stand-in for the AI provider. For any entry it "finds" one dated fact and quotes the entry's
// first line of text, so the answer passes the check that a quote must be in the entry.
const ai = createServer((req, res) => {
  let raw = "";
  req.on("data", (chunk) => (raw += chunk));
  req.on("end", () => {
    res.setHeader("content-type", "application/json");
    if (req.url.endsWith("/models")) {
      res.end(
        JSON.stringify({
          data: [
            {
              id: "sample/reader",
              name: "Sample reader",
              pricing: { prompt: "0.000001", completion: "0.000002" },
              supported_parameters: ["structured_outputs"],
            },
          ],
        }),
      );
      return;
    }
    const user = JSON.parse(raw).messages[1].content;
    const lines = user.split("\n").slice(1);
    const quote = lines.find((l) => l.trim() !== "" && !l.startsWith("#")) ?? "";
    const answer = user.startsWith("Entry:")
      ? { type: null, time: [{ what: "happened", when: "in the year of the test", quote }] }
      : { reply: "ok" };
    res.end(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify(answer) } }],
        usage: { prompt_tokens: 100, completion_tokens: 20, cost: 0.001 },
      }),
    );
  });
});
await new Promise((resolve) => ai.listen(0, "127.0.0.1", resolve));
process.env.OPENROUTER_BASE_URL = `http://127.0.0.1:${ai.address().port}`;
process.env.SECRETS_KEY = Buffer.alloc(32, 5).toString("base64");

await import("../../server/dist/main.js");
