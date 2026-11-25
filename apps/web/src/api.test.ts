// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { CLIENT_API } from "@frontier/schema";
import { api, ApiFailure, eventsIn, setDevice } from "./api.ts";
import { connection } from "./sync/connection.ts";

/** Answers every request with `res`, and keeps what was asked. */
function answer(res: () => Response) {
  const asked: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      asked.push({ url, init });
      return res();
    }),
  );
  return asked;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const page = (status: number) =>
  new Response("<html><body>Bad gateway</body></html>", {
    status,
    headers: { "content-type": "text/html" },
  });

/** The failure a read ends in. */
async function failureOf(read: Promise<unknown>): Promise<ApiFailure> {
  try {
    await read;
  } catch (e) {
    return e as ApiFailure;
  }
  throw new Error("the read did not fail");
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setDevice(null);
});

describe("api", () => {
  it("names the client API on every request, also before the device is known", async () => {
    const asked = answer(() => json(200, { ok: true }));
    await api.tree();
    setDevice({ id: "abcdefghijkl", name: "Safari on iPhone" });
    await api.logout();
    const first = asked[0]!.init.headers as Record<string, string>;
    expect(first["frontier-api"]).toBe(String(CLIENT_API));
    expect(first["frontier-device"]).toBeUndefined();
    const second = asked[1]!.init.headers as Record<string, string>;
    expect(second).toMatchObject({
      "frontier-api": String(CLIENT_API),
      "frontier-device": "abcdefghijkl",
      "frontier-device-name": "Safari%20on%20iPhone",
    });
  });

  it("keeps the headers a request gives", async () => {
    const asked = answer(() => json(200, { id: "d", revision: 1 }));
    await api.saveDraft({ id: "d", path: "a.md", kind: "edit", text: "x", revision: 0 });
    expect(asked[0]!.init.headers).toMatchObject({
      "content-type": "application/json",
      "frontier-api": String(CLIENT_API),
    });
  });

  it("counts a gateway's answer and an answer that is not JSON as no connection", async () => {
    const unreachable = vi.spyOn(connection, "unreachable").mockImplementation(() => undefined);
    for (const res of [
      () => page(502),
      () => page(503),
      () => page(504),
      () => json(503, { message: "upstream" }),
      () => new Response("<html>Sign in to the Wi-Fi</html>", { status: 200 }),
    ]) {
      answer(res);
      const failure = await failureOf(api.tree());
      expect(failure).toBeInstanceOf(ApiFailure);
      expect(failure.status).toBe(0);
      expect(failure.code).toBe("offline");
    }
    expect(unreachable).toHaveBeenCalledTimes(5);
  });

  it("shows what the server itself answered", async () => {
    const unreachable = vi.spyOn(connection, "unreachable").mockImplementation(() => undefined);
    vi.spyOn(connection, "reached").mockImplementation(() => undefined);
    answer(() => page(500));
    expect((await failureOf(api.tree())).status).toBe(500);
    answer(() => json(404, { error: { code: "not_found", message: "There is no such entry." } }));
    const missing = await failureOf(api.entry("a.md"));
    expect(missing.status).toBe(404);
    expect(missing.message).toBe("There is no such entry.");
    // Frontier's own 502 and 503 carry its error, and are the server's answer.
    answer(() => json(502, { error: { code: "push_failed", message: "GitHub refused." } }));
    const push = await failureOf(api.tree());
    expect(push.status).toBe(502);
    expect(push.code).toBe("push_failed");
    expect(unreachable).not.toHaveBeenCalled();
  });

  it("counts a failed fetch as no connection, as before", async () => {
    const unreachable = vi.spyOn(connection, "unreachable").mockImplementation(() => undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    expect((await failureOf(api.tree())).status).toBe(0);
    // The session is asked without a session: its failure says nothing about the connection.
    expect((await failureOf(api.session())).status).toBe(0);
    expect(unreachable).toHaveBeenCalledTimes(1);
  });
});

describe("asking with the work shown", () => {
  it("splits server-sent events, skipping keep-alives and keeping an unfinished one", () => {
    const { events, rest } = eventsIn(
      ': padding\n\nevent: step\ndata: {"n":0}\n\n: keep-alive\r\n\r\nevent: reasoning\ndata: {"te',
    );
    expect(events).toEqual([{ event: "step", data: '{"n":0}' }]);
    expect(rest).toBe('event: reasoning\ndata: {"te');
  });

  it("passes each event on, returns the answer, and throws an error event in its own words", async () => {
    const body = (text: string) => () =>
      new Response(text, { headers: { "content-type": "text/event-stream" } });
    answer(
      body(
        'event: run\ndata: {"run":"r1","conversation":"c"}\n\n' +
          'event: reasoning\ndata: {"text":"Hm."}\n\n' +
          'event: done\ndata: {"conversation":{"id":"c"},"gone":[]}\n\n',
      ),
    );
    const seen: unknown[] = [];
    const done = await api.askStreamed("Q?", undefined, (e) => seen.push(e));
    expect(seen).toEqual([
      { type: "run", run: "r1", conversation: "c" },
      { type: "reasoning", text: "Hm." },
    ]);
    expect(done.conversation.id).toBe("c");

    answer(
      body('event: error\ndata: {"code":"ai_failed","message":"The provider fell over."}\n\n'),
    );
    const failure = await failureOf(api.askStreamed("Q?", undefined, () => undefined));
    expect(failure.code).toBe("ai_failed");
    expect(failure.message).toBe("The provider fell over.");

    answer(body('event: run\ndata: {"run":"r1","conversation":"c"}\n\n'));
    const lost = await failureOf(api.askStreamed("Q?", undefined, () => undefined));
    expect(lost.message).toContain("connection was lost");
  });
});

describe("keep going", () => {
  /** What the last request was: its method, address and body. */
  const last = (asked: { url: string; init: RequestInit }[]) => {
    const { url, init } = asked.at(-1)!;
    return {
      method: init.method ?? "GET",
      url,
      body: typeof init.body === "string" ? (JSON.parse(init.body) as unknown) : undefined,
    };
  };

  it("reads the queue, the week, From here and the question", async () => {
    const asked = answer(() => json(200, {}));
    await api.keepGoingQueue();
    expect(last(asked)).toMatchObject({ method: "GET", url: "/api/keep-going/queue" });
    await api.keepGoingWeek(120);
    expect(last(asked).url).toBe("/api/keep-going/week?tz=120");
    await api.keepGoingWeek();
    expect(last(asked).url).toMatch(/^\/api\/keep-going\/week\?tz=-?\d+$/);
    await api.fromHere("01 Places/Old Quay.md");
    expect(last(asked).url).toBe("/api/keep-going/from-here?path=01%20Places%2FOld%20Quay.md");
    await api.todaysQuestion(-60);
    expect(last(asked).url).toBe("/api/keep-going/question?tz=-60");
    await api.todaysQuestion();
    expect(last(asked).url).toMatch(/^\/api\/keep-going\/question\?tz=-?\d+$/);
  });

  it("asks for a random entry of a kind", async () => {
    const asked = answer(() => json(200, { entry: null }));
    await api.randomEntry();
    expect(last(asked).url).toBe("/api/keep-going/random");
    await api.randomEntry({ kind: "folder", folder: "01 Places", not: "A B.md" });
    expect(last(asked).url).toBe("/api/keep-going/random?kind=folder&folder=01+Places&not=A+B.md");
  });

  it("links a mention, takes it back, and asks for the next steps", async () => {
    const asked = answer(() => json(200, { ok: true }));
    await api.linkIt("A.md", "B.md");
    expect(last(asked)).toEqual({
      method: "POST",
      url: "/api/keep-going/link-it",
      body: { path: "A.md", target: "B.md" },
    });
    const undo = { path: "A.md", draftId: "abcdefghijkl", revision: 2, previousText: null };
    await api.undoLinkIt(undo);
    expect(last(asked)).toEqual({
      method: "POST",
      url: "/api/keep-going/link-it/undo",
      body: undo,
    });
    await api.afterPublish(["A.md"]);
    expect(last(asked).body).toEqual({ paths: ["A.md"] });
  });

  it("asks the AI, with a way to stop it", async () => {
    const asked = answer(() => json(200, {}));
    const stop = new AbortController();
    await api.whatsMissing("A.md", stop.signal);
    expect(last(asked)).toEqual({
      method: "POST",
      url: "/api/keep-going/whats-missing",
      body: { path: "A.md" },
    });
    expect(asked.at(-1)!.init.signal).toBe(stop.signal);
    await api.makeQuestion(true);
    expect(last(asked).body).toMatchObject({ another: true });
    await api.makeQuestion();
    expect(last(asked).body).toMatchObject({ another: false });
  });

  it("pins, unpins and orders entries, and changes the rules", async () => {
    const asked = answer(() => json(200, { pins: [] }));
    await api.pins();
    expect(last(asked)).toMatchObject({ method: "GET", url: "/api/pins" });
    await api.pin("A.md");
    expect(last(asked)).toEqual({ method: "POST", url: "/api/pins", body: { path: "A.md" } });
    await api.unpin("A B.md");
    expect(last(asked)).toMatchObject({ method: "DELETE", url: "/api/pins?path=A%20B.md" });
    await api.reorderPins(["B.md", "A.md"]);
    expect(last(asked)).toEqual({
      method: "PUT",
      url: "/api/pins",
      body: { paths: ["B.md", "A.md"] },
    });
    await api.setKeepGoingSettings({ needsLove: { stub: false } });
    expect(last(asked)).toEqual({
      method: "PUT",
      url: "/api/settings/keep-going",
      body: { needsLove: { stub: false } },
    });
  });
});
