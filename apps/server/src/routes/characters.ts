import type { FastifyInstance } from "fastify";
import { VaultPath } from "@frontier/schema";
import { z } from "zod";
import { Trait } from "../ai/characters.js";
import type { Services } from "../app.js";

const Path = z.object({ path: VaultPath });
const Approve = Path.extend({
  traits: z.array(Trait).max(80),
  moment: z.object({ words: z.string().max(300), year: z.number().nullable() }),
});
const Say = Path.extend({
  message: z.string().trim().min(1).max(2000),
  history: z
    .array(z.object({ who: z.enum(["author", "character"]), text: z.string().max(4000) }))
    .max(40),
});
const Line = Path.extend({ text: z.string().trim().min(1).max(4000) });

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

  app.post("/api/characters/say", async (request) => {
    const { path, message, history } = Say.parse(request.body);
    return { lines: await s.characters.say(path, history, message) };
  });

  /**
   * A line the character said, added to the end of the character's entry as a draft. It is the
   * author's choice from his own conversation; it goes in like a paragraph he typed.
   */
  app.post("/api/characters/line", async (request) => {
    const { path, text } = Line.parse(request.body);
    const model = (await s.settings.read())?.ai.models.conversation ?? "unknown";
    const draft = await s.changer.apply(path, (now) => `${now.replace(/\s*$/, "")}\n\n${text}\n`, {
      kind: "lore",
      ref: `character:${path}`,
      model,
    });
    s.status.drafts(s.drafts.count(), 0);
    return { draft: draft?.id ?? null };
  });
}
