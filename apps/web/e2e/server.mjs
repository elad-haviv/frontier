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
  // The image dialog's web address is tried against the picture server below, on loopback.
  IMAGE_FETCH_ALLOW_LOOPBACK: "1",
});

// A stand-in for a site on the web with one picture, at the server's port plus 100, so the
// browser tests know where it is.
const PICTURE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
// Not 127.0.0.1: where localhost resolves there (the CI machines), PUBLIC_URL makes it this
// server's own address, which the image route refuses. Linux answers on all of 127/8.
const PICTURE_HOST = "127.0.0.2";
const pictures = createServer((req, res) => {
  if (req.url?.split("?")[0].endsWith(".png")) {
    res.writeHead(200, { "content-type": "image/png" });
    res.end(PICTURE);
  } else {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((resolve) =>
  pictures.listen(Number(process.env.PORT) + 100, PICTURE_HOST, resolve),
);

// For a lore question it answers from the first entry it was given, quoting that entry's first
// line of text; a question with "unknown" in it is not in the lore. Asked for an addition, it
// adds a line to that entry.
function firstLine(user) {
  const first = /=== Entry: (.*)\n(?:Title: .*\n\n)?([\s\S]*?)\n=== End/.exec(user);
  const path = first?.[1] ?? "";
  const line = (first?.[2] ?? "")
    .split("\n")
    .find((l) => l.trim() !== "" && !l.startsWith("#") && l.split(/\s+/).length >= 4);
  return { path, line };
}

function discovery(user) {
  const { path, line } = firstLine(user);
  return {
    candidates: [
      {
        kind: "settlement",
        name: "Test Hollow",
        description: "A small place the test found.",
        basis: line ? [{ path, quote: line }] : [],
        conflicts: "",
      },
    ],
  };
}

function character(user) {
  const { path, line } = firstLine(user);
  return {
    lines: [
      { text: line ?? "Hm.", sources: [path], quotes: line ? [{ path, text: line }] : [] },
      { text: "I dream of the sea.", sources: [], quotes: [] },
    ],
  };
}

function lore(user) {
  if (user.includes("\nThe character: ")) {
    const { path, line } = firstLine(user);
    return {
      traits: [
        {
          kind: "knows",
          text: "Is a friend of Mira.",
          sources: [path],
          quotes: line ? [{ path, text: line }] : [],
        },
        { kind: "unknown", text: "Where they were born.", sources: [], quotes: [] },
      ],
    };
  }
  if (user.includes("=== Passage")) {
    const request = /Request: (.*)$/.exec(user)?.[1] ?? "";
    return { text: `A rewritten passage (${request.split(":")[0]}).` };
  }
  const first = /=== Entry: (.*)\nTitle: .*\n\n([\s\S]*?)\n=== End/.exec(user);
  const path = first?.[1] ?? "";
  const line = (first?.[2] ?? "")
    .split("\n")
    .find((l) => l.trim() !== "" && !l.startsWith("#") && l.split(/\s+/).length >= 4);
  if (user.includes("What the entries do not say:")) {
    return { path, text: "A line the test drafted to fill the gap." };
  }
  const question = /Question: (.*)$/.exec(user)?.[1] ?? "";
  if (question.includes("unknown")) {
    return {
      paragraphs: [{ text: "Nothing is said of this.", sources: [], quotes: [] }],
      related: [],
      missing: "The entries do not say this.",
    };
  }
  return {
    paragraphs: [
      {
        text: `It is told in ${path}.`,
        sources: [path],
        quotes: line ? [{ path, text: line }] : [],
      },
      {
        text: "Bells ring at dawn.",
        sources: [path],
        quotes: [{ path, text: "bells ring at dawn always" }],
      },
    ],
    related: [],
    missing: "",
  };
}

// A stand-in for the AI provider. For any entry it "finds" one dated fact and quotes the entry's
// first line of text, so the answer passes the check that a quote must be in the entry.
const ai = createServer((req, res) => {
  let raw = "";
  req.on("data", (chunk) => (raw += chunk));
  req.on("end", () => {
    res.setHeader("content-type", "application/json");
    const path = req.url.split("?")[0];
    // OpenRouter's key check.
    if (path.endsWith("/key")) {
      res.end(JSON.stringify({ data: { label: "e2e" } }));
      return;
    }
    if (path.endsWith("/images")) {
      // A one-pixel picture, for concept art.
      res.end(
        JSON.stringify({
          data: [
            {
              b64_json:
                "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
            },
          ],
          usage: { cost: 0.04 },
        }),
      );
      return;
    }
    if (path.endsWith("/models")) {
      res.end(
        JSON.stringify({
          data: [
            {
              id: "sample/reader",
              name: "Sample reader",
              description: "A small model that reads entries.",
              context_length: 128000,
              pricing: { prompt: "0.000001", completion: "0.000002" },
              supported_parameters: ["structured_outputs"],
              architecture: { input_modalities: ["text"], output_modalities: ["text"] },
            },
            {
              id: "sample/writer",
              name: "Sample writer",
              description: "A larger model for lore conversations.",
              context_length: 1000000,
              pricing: { prompt: "0.000003", completion: "0.000015" },
              supported_parameters: ["structured_outputs", "reasoning"],
              architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] },
            },
            {
              id: "sample/painter",
              name: "Sample painter",
              pricing: { prompt: "0", completion: "0" },
              supported_parameters: [],
              architecture: { input_modalities: ["text"], output_modalities: ["image"] },
            },
            // OpenRouter's name for the Anthropic stand-in's model, which gives it its price.
            {
              id: "anthropic/claude-sample-1",
              name: "Anthropic: Claude Sample 1",
              context_length: 200000,
              pricing: { prompt: "0.000003", completion: "0.000015" },
              supported_parameters: ["structured_outputs"],
              architecture: { input_modalities: ["text"], output_modalities: ["text"] },
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
      : user.startsWith("Entries about what is near")
        ? discovery(user)
        : user.startsWith("The character:")
          ? character(user)
          : user.startsWith("Entries:")
            ? lore(user)
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

// A stand-in for Anthropic: "sk-ant-good" keys work, any other is refused, as Anthropic does.
const anthropic = createServer((req, res) => {
  let raw = "";
  req.on("data", (chunk) => (raw += chunk));
  req.on("end", () => {
    res.setHeader("content-type", "application/json");
    const key = String(req.headers["x-api-key"] ?? "");
    if (!key.startsWith("sk-ant-good")) {
      res.statusCode = 401;
      res.end(
        JSON.stringify({
          type: "error",
          error: { type: "authentication_error", message: "invalid x-api-key" },
        }),
      );
      return;
    }
    if (req.url.split("?")[0].endsWith("/models")) {
      res.end(
        JSON.stringify({
          data: [
            { id: "claude-sample-1", display_name: "Claude Sample 1", max_input_tokens: 200000 },
          ],
          has_more: false,
        }),
      );
      return;
    }
    res.end(
      JSON.stringify({
        type: "message",
        content: [{ type: "text", text: JSON.stringify({ reply: "ok" }) }],
        stop_reason: "end_turn",
        usage: { input_tokens: 100, output_tokens: 20 },
      }),
    );
  });
});
await new Promise((resolve) => anthropic.listen(0, "127.0.0.1", resolve));
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${anthropic.address().port}/v1`;
process.env.SECRETS_KEY = Buffer.alloc(32, 5).toString("base64");

await import("../../server/dist/main.js");
