import type { FastifyRequest } from "fastify";
import type { RouteApp } from "../projects/facade.js";
import {
  AfterPublishRequest,
  type AfterPublishResponse,
  type FromHereResponse,
  LinkItRequest,
  type LinkItResponse,
  LinkItUndoRequest,
  MakeQuestionRequest,
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
import { personOf } from "../auth/session.js";
import { whileAsked } from "./writing.js";

/** Minutes east of UTC, which decides what "today" is for the reader. */
const Tz = z.object({
  tz: z.coerce.number().int().min(-840).max(840).default(0),
});
const PathQuery = z.object({ path: VaultPath });

export function keepGoingRoutes(app: RouteApp, s: Services): void {
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
    return { question: await s.keepGoingAi.today(personOf(request).id, tz) };
  });

  /** Makes today's question, or another one in its place. */
  app.post("/api/keep-going/question", async (request, reply): Promise<QuestionResponse> => {
    const { another, tz } = MakeQuestionRequest.parse(request.body ?? {});
    const question = await s.keepGoingAi.ask(personOf(request).id, tz ?? 0, another === true, {
      signal: whileAsked(reply),
    });
    return { question };
  });

  // ---- Pins ------------------------------------------------------------------------------

  const pins = (request: FastifyRequest): Promise<PinsResponse> =>
    s.pins.list(
      personOf(request).id,
      (path) => s.keepGoing.titleOf(path),
      (path) => s.keepGoing.wordsOf(path),
    );

  app.get("/api/pins", async (request): Promise<PinsResponse> => pins(request));

  app.post("/api/pins", async (request): Promise<PinsResponse> => {
    await s.pins.add(personOf(request).id, PinRequest.parse(request.body).path);
    return pins(request);
  });

  app.delete("/api/pins", async (request): Promise<PinsResponse> => {
    await s.pins.remove(personOf(request).id, PinRequest.parse(request.query).path);
    return pins(request);
  });

  app.put("/api/pins", async (request): Promise<PinsResponse> => {
    await s.pins.reorder(personOf(request).id, PinOrderRequest.parse(request.body).paths);
    return pins(request);
  });
}
