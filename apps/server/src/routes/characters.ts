import type { FastifyInstance } from "fastify";
import { VaultPath } from "@frontier/schema";
import { z } from "zod";
import { Trait } from "../ai/characters.js";
import { summaryOf } from "../ai/talks.js";
import type { Services } from "../app.js";
import { ApiError } from "../errors.js";

const Path = z.object({ path: VaultPath });
const TalkId = z.string().regex(/^[a-z0-9]{12}$/);
const Approve = Path.extend({
  traits: z.array(Trait).max(80),
  moment: z.object({ words: z.string().max(300), year: z.number().nullable() }),
});
const Say = Path.extend({
  message: z.string().trim().min(1).max(2000),
  /** The conversation to go on with; a new one is started without it. */
  talk: TalkId.nullish(),
});
const Line = Path.extend({
  text: z.string().trim().min(1).max(4000),
  /** Where the line is in a saved conversation, so it is marked there as added. */
  talk: TalkId.nullish(),
  line: z.number().int().min(0).nullish(),
});
const Moment = Path.extend({
  year: z
    .string()
    .optional()
    .transform((y) => (y === undefined || y.trim() === "" ? null : Number(y)))
    .refine((y) => y === null || Number.isFinite(y), "The year is a number, or empty."),
});

export function characterRoutes(app: FastifyInstance, s: Services): void {
  app.get("/api/characters/profile", async (request) => {
    const { path } = Path.parse(request.query);
    return { profile: await s.characters.profile(path) };
  });

  app.post("/api/characters/propose", async (request) => {
    const { path } = Path.parse(request.body);
    return s.characters.propose(path);
  });

  app.post("/api/characters/approve", async (request) => {
    const { path, traits, moment } = Approve.parse(request.body);
    const result = await s.characters.approve(path, { traits, moment });
    s.status.drafts(s.drafts.count(), 0);
    return result;
  });

  /** Which of the entries read for the profile a year of the main chronicle keeps from them. */
  app.get("/api/characters/moment", async (request) => {
    const { path, year } = Moment.parse(request.query);
    return s.characters.withheld(path, year);
  });

  /** The character's saved conversations, the latest spoken in first, without their lines. */
  app.get("/api/characters/talks", async (request) => {
    const { path } = Path.parse(request.query);
    const profile = await s.characters.profile(path);
    if (!profile) return { talks: [] };
    return { talks: (await s.talks.forEntry(profile.entry)).map(summaryOf) };
  });

  app.get("/api/characters/talks/:id", async (request) => {
    const { id } = z.object({ id: TalkId }).parse(request.params);
    const talk = await s.talks.get(id);
    if (!talk) throw new ApiError("not_found", "That conversation is not there any more.");
    return { talk };
  });

  app.delete("/api/characters/talks/:id", async (request) => {
    const { id } = z.object({ id: TalkId }).parse(request.params);
    await s.talks.remove(id);
    return { ok: true };
  });

  /** Says something to the character. The author's words and the answer are saved together. */
  app.post("/api/characters/say", async (request) => {
    const { path, message, talk: id } = Say.parse(request.body);
    const profile = await s.characters.profile(path);
    if (!profile) throw new ApiError("invalid", "Approve a profile for this character first.");
    const before = id ? await s.talks.get(id) : null;
    if (id && (!before || before.entry !== profile.entry)) {
      throw new ApiError("not_found", "That conversation is not there any more.");
    }
    const history = (before?.lines ?? []).map((l) => ({ who: l.who, text: l.text }));
    const lines = await s.characters.say(path, history, message);
    const talk = await s.talks.change(
      id ?? null,
      { entry: profile.entry, moment: profile.moment },
      (t) => ({
        ...t,
        updatedAt: new Date().toISOString(),
        moment: profile.moment,
        lines: [
          ...t.lines,
          { who: "author" as const, text: message },
          ...lines.map((l) => ({ who: "character" as const, ...l, kept: false })),
        ],
      }),
    );
    return { talk, lines };
  });

  /**
   * A line the character said, added to the end of the character's entry as a draft. It is the
   * author's choice from his own conversation; it goes in like a paragraph he typed.
   */
  app.post("/api/characters/line", async (request) => {
    const { path, text, talk: id, line } = Line.parse(request.body);
    const model = (await s.settings.read())?.ai.models.conversation ?? "unknown";
    const draft = await s.changer.apply(path, (now) => `${now.replace(/\s*$/, "")}\n\n${text}\n`, {
      kind: "lore",
      ref: `character:${path}`,
      model,
    });
    s.status.drafts(s.drafts.count(), 0);
    const profile = id ? await s.characters.profile(path) : null;
    const talk =
      id && profile && typeof line === "number"
        ? await s.talks
            .change(id, { entry: profile.entry, moment: profile.moment }, (t) => ({
              ...t,
              lines: t.lines.map((l, i) =>
                i === line && l.who === "character" && l.text === text ? { ...l, kept: true } : l,
              ),
            }))
            .catch(() => null)
        : null;
    return { draft: draft?.id ?? null, talk };
  });
}
