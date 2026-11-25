// Starts the built server on the sample vault, in a data folder that is emptied first.
import { Buffer } from "node:buffer";
import { rmSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import process from "node:process";
import { clearTimeout, setTimeout } from "node:timers";
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
const slow = { started: 0, stopped: 0 };
const pictures = createServer((req, res) => {
  if (req.url === "/ai-slow") {
    // How many slow writing-help calls the AI stand-in below began, and how many were stopped.
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(slow));
  } else if (req.url?.split("?")[0].endsWith(".png")) {
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

// One discovery for each place asked about: "Test Hollow", then "Test Hollow 2" and so on, an
// inn at the first place.
function discovery(user) {
  const { path, line } = firstLine(user);
  const places = Math.max(1, (user.match(/^=== Place \d+:/gm) ?? []).length);
  return {
    places: Array.from({ length: places }, (_, i) => ({
      place: i + 1,
      candidates: [
        {
          kind: "settlement",
          role: i === 0 ? "inn" : "camp",
          name: `Test Hollow${i ? ` ${i + 1}` : ""}`,
          description: "A small place the test found.",
          basis: line ? [{ path, quote: line }] : [],
          conflicts: "",
        },
      ],
    })),
  };
}

// Names and descriptions for features to fill in or place: as many as asked, each with the first
// look offered, if any.
function generated(user) {
  const asked = /What to propose: (one feature|(\d) features)/.exec(user);
  const count = asked?.[2] ? Number(asked[2]) : 1;
  const look = /Looks to choose from:\n- (.*?): /.exec(user)?.[1] ?? "";
  return {
    items: Array.from({ length: count }, (_, i) => ({
      name: `Test Watchtower${i ? ` ${i + 1}` : ""}`,
      description: "A watchtower the test made up.",
      choice: look,
      basis: [],
    })),
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
  if (user.includes("\nWhat the author said:\n")) {
    // Drafting an entry from speech: a title from his first words, a line that contradicts the
    // first entry it was given (backed by that entry's own first line), and one question left open.
    const { path, line } = firstLine(user);
    const said = user.split("What the author said:\n")[1]?.trim() ?? "";
    return {
      title: said.split(/\s+/).slice(0, 2).join(" ") || "Untitled",
      folder: path.split("/").slice(0, -1).join("/"),
      paragraphs: ["A warden of the harbour lights.", "The lights are never lit."],
      notSaid: ["How old is the warden?"],
      conflicts: line && path ? [{ paragraph: 1, path, quote: line }] : [],
    };
  }
  if (user.includes("=== Paragraph")) {
    // Looking again at an edited paragraph: nothing contradicts it now.
    return { conflicts: [] };
  }
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
    // Writing help: the request's first words, and which try it is when asked again.
    const request = /Request: (.*)$/.exec(user)?.[1] ?? "";
    const tries = (user.match(/--- Suggestion \d+/g) ?? []).length;
    return {
      text: tries
        ? `Another rewritten passage (${request.split(":")[0]}, try ${tries + 1}).`
        : `A rewritten passage (${request.split(":")[0]}).`,
    };
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
  // "Look further" makes the model ask for more once before it answers.
  if (question.includes("Look further") && !user.includes("You asked for:")) {
    return {
      paragraphs: [],
      related: [],
      missing: "",
      more: { searches: ["Mira"], entries: [] },
    };
  }
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

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Sends an answer as OpenRouter streams one: a keep-alive comment, the model's reasoning in pieces,
 * then the answer in pieces and the usage. A question with "slowly" in it reasons for a long while,
 * so a test can watch it work and stop it; one with "fall over" fails partway, as a provider can.
 */
async function streamAnswer(req, res, content, user) {
  const question = /Question: (.*)$/.exec(user)?.[1] ?? "";
  let open = true;
  res.on("close", () => (open = false));
  const send = (data) => open && res.write(`data: ${JSON.stringify(data)}\n\n`);
  res.writeHead(200, { "content-type": "text/event-stream" });
  res.write(": OPENROUTER PROCESSING\n\n");
  const thoughts = (
    "Looking at the entries I was given. The first one answers the question; " +
    "I will quote its opening line."
  ).split(/(?<= )/);
  const wait = question.includes("slowly") ? 1500 : question.includes("Look further") ? 200 : 60;
  for (const piece of thoughts) {
    if (!open) return;
    send({ choices: [{ delta: { reasoning: piece } }] });
    await pause(wait);
  }
  if (question.includes("fall over")) {
    send({ error: { code: 502, message: "The test provider fell over" }, choices: [] });
    res.end();
    return;
  }
  for (let at = 0; at < content.length && open; at += 30) {
    send({ choices: [{ delta: { content: content.slice(at, at + 30) } }] });
    await pause(15);
  }
  send({
    choices: [{ delta: {} }],
    usage: { prompt_tokens: 100, completion_tokens: 20, cost: 0.001 },
  });
  if (open) res.end("data: [DONE]\n\n");
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
    const asked = JSON.parse(raw);
    const user = asked.messages[1].content;
    // A model that spends its room thinking: the answer stops at the token limit, cut off.
    if (user.includes('"Truncated Point"')) {
      res.end(
        JSON.stringify({
          choices: [
            { message: { content: '{"candidates":[{"kind":"sett' }, finish_reason: "length" },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 10500, cost: 0.001 },
        }),
      );
      return;
    }
    const lines = user.split("\n").slice(1);
    const quote = lines.find((l) => l.trim() !== "" && !l.startsWith("#")) ?? "";
    const answer = user.startsWith("Entry:")
      ? { type: null, time: [{ what: "happened", when: "in the year of the test", quote }] }
      : user.includes("\nWhat to propose: ")
        ? generated(user)
        : user.startsWith("Entries about what is near")
          ? discovery(user)
          : user.startsWith("The character:")
            ? character(user)
            : user.startsWith("Entries:")
              ? lore(user)
              : { reply: "ok" };
    if (asked.stream) {
      void streamAnswer(req, res, JSON.stringify(answer), user);
      return;
    }
    const send = () =>
      res.end(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(answer) } }],
          usage: { prompt_tokens: 100, completion_tokens: 20, cost: 0.001 },
        }),
      );
    // Writing help asked to go "slowly" answers late, so a test can press Stop meanwhile; the
    // call it stops is counted, for the test to see that it was stopped.
    if (/Request: .*slowly/.test(user)) {
      slow.started++;
      const late = setTimeout(send, 8000);
      res.on("close", () => {
        if (!res.writableFinished) {
          clearTimeout(late);
          slow.stopped++;
        }
      });
    } else send();
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
