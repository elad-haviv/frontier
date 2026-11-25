import type { FastifyInstance } from "fastify";
import {
  AfterPublishRequest,
  type AfterPublishResponse,
  type FromHereResponse,
  KeepGoingSettingsRequest,
  LinkItRequest,
  type LinkItResponse,
  LinkItUndoRequest,
  MakeQuestionRequest,
  NeedsLoveRules,
  PinOrderRequest,
  PinRequest,
  type PinsResponse,
  type QueueResponse,
  type QuestionResponse,
  RandomQuery,
  type RandomResponse,
  VaultPath,
  WhatsMissingRequest,
  type WhatsMissingResponse,
  type WeekResponse,
} from "@frontier/schema";
import { z } from "zod";
import type { Services } from "../app.js";
import { whileAsked } from "./writing.js";

/** Minutes east of UTC, which decides what "today" is for the reader. */
const Tz = z.object({
  tz: z.coerce.number().int().min(-840).max(840).default(0),
});
const PathQuery = z.object({ path: VaultPath });

export function keepGoingRoutes(app: FastifyInstance, s: Services): void {
  const changed = () => s.status.drafts(s.drafts.count(), 0);

  /** Every list of Home's work queue, from the published index. */
  app.get("/api/keep-going/queue", async (): Promise<QueueResponse> => s.keepGoing.queue());

  /** This week's numbers and "on this day", from the library's saved versions. */
  app.get("/api/keep-going/week", async (request): Promise<WeekResponse> => {
    const { tz } = Tz.parse(request.query);
    return s.keepGoingHistory.weekAndOnThisDay(tz);
  });

  app.get("/api/keep-going/from-here", async (request): Promise<FromHereResponse> => {
    const { path } = PathQuery.parse(request.query);
    return s.keepGoing.fromHere(path);
  });

  app.post("/api/keep-going/link-it", async (request): Promise<LinkItResponse> => {
    const input = LinkItRequest.parse(request.body);
    const made = await s.keepGoing.linkIt(input);
    changed();
    return made;
  });

  app.post("/api/keep-going/link-it/undo", async (request) => {
    await s.keepGoing.undoLinkIt(LinkItUndoRequest.parse(request.body));
    return { ok: true as const };
  });

  app.get("/api/keep-going/random", async (request): Promise<RandomResponse> => {
    return s.keepGoing.randomEntry(RandomQuery.parse(request.query));
  });

  app.post("/api/keep-going/after-publish", async (request): Promise<AfterPublishResponse> => {
    const { paths } = AfterPublishRequest.parse(request.body);
    return s.keepGoing.afterPublish(paths);
  });

  // ---- AI --------------------------------------------------------------------------------

  /** The entries an entry implies and the questions it leaves open. Nothing is saved. */
  app.post(
    "/api/keep-going/whats-missing",
    async (request, reply): Promise<WhatsMissingResponse> => {
      const { path } = WhatsMissingRequest.parse(request.body);
      return s.keepGoingAi.whatsMissing(path, { signal: whileAsked(reply) });
    },
  );

  /** Today's question, if one was made. Never makes one. */
  app.get("/api/keep-going/question", async (request): Promise<QuestionResponse> => {
    const { tz } = Tz.parse(request.query);
    return { question: await s.keepGoingAi.today(tz) };
  });

  /** Makes today's question, or another one in its place. */
  app.post("/api/keep-going/question", async (request, reply): Promise<QuestionResponse> => {
    const { another, tz } = MakeQuestionRequest.parse(request.body ?? {});
    const question = await s.keepGoingAi.ask(tz ?? 0, another === true, {
      signal: whileAsked(reply),
    });
    return { question };
  });

  // ---- Pins ------------------------------------------------------------------------------

  const pins = (): Promise<PinsResponse> =>
    s.pins.list(
      (path) => s.keepGoing.titleOf(path),
      (path) => s.keepGoing.wordsOf(path),
    );

  app.get("/api/pins", async (): Promise<PinsResponse> => pins());

  app.post("/api/pins", async (request): Promise<PinsResponse> => {
    await s.pins.add(PinRequest.parse(request.body).path);
    changed();
    return pins();
  });

  app.delete("/api/pins", async (request): Promise<PinsResponse> => {
    await s.pins.remove(PinRequest.parse(request.query).path);
    changed();
    return pins();
  });

  app.put("/api/pins", async (request): Promise<PinsResponse> => {
    await s.pins.reorder(PinOrderRequest.parse(request.body).paths);
    changed();
    return pins();
  });

  // ---- Settings -------------------------------------------------------------------------

  app.put("/api/settings/keep-going", async (request) => {
    const input = KeepGoingSettingsRequest.parse(request.body);
    const next = await s.settings.update((now) => ({
      ...now,
      keepGoing: {
        needsLove: NeedsLoveRules.parse({
          ...now.keepGoing.needsLove,
          ...stripUndefined(input.needsLove),
        }),
      },
    }));
    return next.keepGoing;
  });
}

function stripUndefined<T extends object>(value: T | undefined): Partial<T> {
  return Object.fromEntries(
    Object.entries(value ?? {}).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
}
