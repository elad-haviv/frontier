import { createHash, randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { makeId } from "@frontier/schema";
import { isEditable, isNote } from "@frontier/vault";
import { z } from "zod";
import { ApiError } from "../errors.js";
import type { Conversation, Turn } from "../ai/conversations.js";
import type { Services } from "../app.js";

const IdParam = z.object({ id: z.string().regex(/^[a-z0-9]{12}$/) });
const RunParam = z.object({ run: z.string().regex(/^[a-f0-9]{32}$/) });
const TurnParam = IdParam.extend({ n: z.coerce.number().int().min(0) });
const Ask = z.object({
  question: z.string().trim().min(1).max(2000),
  conversation: z
    .string()
    .regex(/^[a-z0-9]{12}$/)
    .optional(),
});
const Draft = z.object({ again: z.boolean().default(false) });
const Target = z.object({ path: z.string().min(1).max(500) });
const Keep = Target.extend({ base: z.string().regex(/^[a-f0-9]{64}$/) });

const hash = (text: string) => createHash("sha256").update(text).digest("hex");
/** The text with the addition after it, under a blank line. */
const appended = (text: string, addition: string) =>
  `${text.replace(/\s*$/, "")}\n\n${addition.trim()}\n`;

export function loreRoutes(app: FastifyInstance, s: Services): void {
  // One change at a time to each conversation, so two answers arriving together keep both turns.
  const queues = new Map<string, Promise<unknown>>();
  const inTurn = <T>(id: string, work: () => Promise<T>): Promise<T> => {
    const run = (queues.get(id) ?? Promise.resolve()).then(work, work);
    queues.set(
      id,
      run.catch(() => undefined),
    );
    return run;
  };

  const load = async (id: string): Promise<Conversation> => {
    const c = await s.conversations.get(id);
    if (!c) throw new ApiError("not_found", "There is no such conversation.");
    return c;
  };
  const turnOf = (c: Conversation, n: number): Turn => {
    const turn = c.turns[n];
    if (!turn) throw new ApiError("not_found", "There is no such answer in this conversation.");
    return turn;
  };
  /** Paths named in a conversation that no longer lead to an entry. */
  const gone = (c: Conversation) =>
    [
      ...new Set(
        c.turns.flatMap((t) => [
          ...t.answer.paragraphs.flatMap((p) => p.sources),
          ...t.answer.related.map((r) => r.path),
        ]),
      ),
    ].filter((p) => !s.index.note(p));

  app.get("/api/lore", async () => ({
    conversations: (await s.conversations.list()).map((c) => ({
      id: c.id,
      title: c.title,
      at: c.turns.at(-1)?.at ?? c.at,
      turns: c.turns.length,
    })),
    ready: await s.ai.ready("conversation"),
  }));

  app.get("/api/lore/:id", async (request) => {
    const c = await load(IdParam.parse(request.params).id);
    return { conversation: c, gone: gone(c) };
  });

  app.post("/api/lore", async (request) => {
    const { question, conversation } = Ask.parse(request.body);
    const start = conversation ? await load(conversation) : await s.conversations.create(question);
    return inTurn(start.id, async () => {
      const c = conversation ? await load(conversation) : start;
      const turn = await s.lore.ask(question, c.turns, { entry: `lore:${c.id}` });
      const next = { ...c, turns: [...c.turns, turn] };
      await s.conversations.save(next);
      return { conversation: next, gone: gone(next) };
    });
  });

  /** The answers being worked on, by run, so the author can stop one. */
  const runs = new Map<string, AbortController>();

  /**
   * Asks as `POST /api/lore` does, but answers as server-sent events while it works: `run` first,
   * then each `step`, the model's `reasoning` and how much it has `writing`, and last `done` with
   * what `POST /api/lore` answers, or `error`. A connection that closes does not stop the work: the
   * turn is still saved. `POST /api/lore/runs/:run/stop` stops it.
   */
  app.post("/api/lore/stream", async (request, reply) => {
    const { question, conversation } = Ask.parse(request.body);
    const start = conversation ? await load(conversation) : await s.conversations.create(question);
    // Refused as a plain error while it still can be, before the stream starts.
    await s.lore.model();

    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      // No proxy may hold the events back to compress or gather them (nginx reads the last one).
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
      "x-content-type-options": "nosniff",
    });
    let open = true;
    const write = (text: string) => {
      if (open) res.write(text);
    };
    const send = (event: string, data: unknown) =>
      write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    // Some proxies hold back the first few kilobytes; a comment that long gets the events moving.
    write(`: ${" ".repeat(2048)}\n\n`);
    // A comment now and then keeps the proxies in front from closing a quiet connection.
    const beat = setInterval(() => write(": keep-alive\n\n"), 15_000);
    res.on("close", () => {
      open = false;
      clearInterval(beat);
    });

    const run = randomBytes(16).toString("hex");
    const stop = new AbortController();
    runs.set(run, stop);
    send("run", { run, conversation: start.id });
    try {
      const done = await inTurn(start.id, async () => {
        const c = conversation ? await load(conversation) : start;
        const turn = await s.lore.ask(question, c.turns, {
          entry: `lore:${c.id}`,
          signal: stop.signal,
          onEvent: (e) => send(e.type, e),
        });
        const next = { ...c, turns: [...c.turns, turn] };
        await s.conversations.save(next);
        return { conversation: next, gone: gone(next) };
      });
      send("done", done);
    } catch (err) {
      if (err instanceof ApiError) {
        send("error", { code: err.code, message: err.message });
      } else {
        app.log.error(err);
        send("error", { code: "merge_failed", message: "The server hit an unexpected error." });
      }
    } finally {
      runs.delete(run);
      clearInterval(beat);
      if (open) res.end();
    }
  });

  app.post("/api/lore/runs/:run/stop", async (request) => {
    const { run } = RunParam.parse(request.params);
    runs.get(run)?.abort();
    return { ok: true as const };
  });

  app.delete("/api/lore/:id", async (request) => {
    const { id } = IdParam.parse(request.params);
    await inTurn(id, () => s.conversations.remove(id));
    return { ok: true as const };
  });

  /** Drafts an addition for what an answer says is missing, or returns the one drafted before. */
  app.post("/api/lore/:id/turns/:n/addition", async (request) => {
    const { id, n } = TurnParam.parse(request.params);
    const { again } = Draft.parse(request.body ?? {});
    return inTurn(id, async () => {
      const c = await load(id);
      const turn = turnOf(c, n);
      if (turn.addition && !again) return { addition: turn.addition, conversation: c };
      const addition = await s.lore.addition(turn, `lore:${id}`);
      const next = {
        ...c,
        turns: c.turns.map((t, i) => (i === n ? { ...t, addition, kept: null } : t)),
      };
      await s.conversations.save(next);
      return { addition, conversation: next };
    });
  });

  /** Where an addition can go: an entry the answer was given, or the new entry proposed. */
  const place = async (turn: Turn, path: string) => {
    const addition = turn.addition;
    if (!addition) throw new ApiError("invalid", "Draft an addition first.");
    const isNew = path === addition.newPath;
    if (!isNew && !turn.given.includes(path)) {
      throw new ApiError(
        "invalid",
        "An addition goes into one of the entries the answer was read from.",
      );
    }
    if (!isNote(path) || !isEditable(path)) {
      throw new ApiError("not_allowed", "This file cannot take an addition.");
    }
    const draft = s.drafts.byPath(path);
    if (isNew) {
      if (s.index.note(path) || draft) {
        throw new ApiError(
          "not_allowed",
          `"${path}" exists now. Choose where the addition goes again.`,
        );
      }
      return { isNew, before: "", after: `${addition.text}\n` };
    }
    if (s.drafts.listRenames().some((r) => r.from === path)) {
      throw new ApiError("not_allowed", "This entry is being renamed. Save that first.");
    }
    if (draft?.kind === "delete") {
      throw new ApiError("not_allowed", "This entry is marked for deletion.");
    }
    if (draft && s.drafts.hasKeptCopies(draft.id)) {
      throw new ApiError(
        "not_allowed",
        "This entry has texts from other devices to compare. Merge them first.",
      );
    }
    const before = await s.changer.text(path);
    if (before === null) throw new ApiError("not_found", `There is no entry at "${path}" now.`);
    return { isNew, before, after: appended(before, addition.text) };
  };

  /** The difference the author reads before keeping an addition: against his draft if he has one. */
  app.post("/api/lore/:id/turns/:n/addition/preview", async (request) => {
    const { id, n } = TurnParam.parse(request.params);
    const { path } = Target.parse(request.body);
    const turn = turnOf(await load(id), n);
    const placed = await place(turn, path);
    return { path, ...placed, base: hash(placed.before) };
  });

  /**
   * Keeps an addition as a draft. The server appends the text it stored to the entry as it is now,
   * and refuses when that is not what the author was shown.
   */
  app.post("/api/lore/:id/turns/:n/addition/keep", async (request) => {
    const { id, n } = TurnParam.parse(request.params);
    const { path, base } = Keep.parse(request.body);
    return inTurn(id, async () => {
      const c = await load(id);
      const turn = turnOf(c, n);
      const placed = await place(turn, path);
      if (hash(placed.before) !== base) {
        throw new ApiError(
          "changed",
          "This entry changed since the difference was shown. Look at it again.",
        );
      }
      const origin = { kind: "lore" as const, ref: `${id}/${n}`, model: turn.addition!.model };
      const draft = placed.isNew
        ? await s.drafts.saveFrom({
            id: makeId(randomBytes),
            path,
            kind: "create",
            content: placed.after,
            baseBlob: "",
            lineEnding: "lf",
            origin,
          })
        : await s.changer.apply(path, (text) => appended(text, turn.addition!.text), origin);
      s.status.drafts(s.drafts.count(), 0);
      const next = {
        ...c,
        turns: c.turns.map((t, i) =>
          i === n ? { ...t, kept: { path, at: new Date().toISOString() } } : t,
        ),
      };
      await s.conversations.save(next);
      return { draft: draft?.id ?? null, conversation: next };
    });
  });
}
