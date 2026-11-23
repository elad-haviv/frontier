import { createHash, randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { makeId } from "@frontier/schema";
import { isEditable, isNote } from "@frontier/vault";
import { z } from "zod";
import { ApiError } from "../errors.js";
import type { Conversation, Turn } from "../ai/conversations.js";
import type { Services } from "../app.js";

const IdParam = z.object({ id: z.string().regex(/^[a-z0-9]{12}$/) });
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
      const turn = await s.lore.ask(question, c.turns, `lore:${c.id}`);
      const next = { ...c, turns: [...c.turns, turn] };
      await s.conversations.save(next);
      return { conversation: next, gone: gone(next) };
    });
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
