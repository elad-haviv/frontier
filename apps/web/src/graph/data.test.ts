import { describe, expect, it } from "vitest";
import type { GraphResponse } from "@frontier/schema";
import { ApiFailure } from "../api.ts";
import { GraphData, NEEDS_CONNECTION } from "./data.ts";

const EMPTY: GraphResponse = { nodes: [], edges: [], folders: [], nested: [] };
const one = (path: string): GraphResponse => ({
  ...EMPTY,
  nodes: [{ path, title: path, type: null }],
});

/** A graph source whose answers the test gives by hand, with a status stream and a queue. */
function source() {
  const answers: { resolve: (r: GraphResponse) => void; reject: (e: unknown) => void }[] = [];
  const status = new Set<() => void>();
  const list = new Set<() => void>();
  let entries = new Map<string, number>();
  const data = new GraphData({
    fetch: () => new Promise((resolve, reject) => answers.push({ resolve, reject })),
    onStatus: (l) => {
      status.add(l);
      return () => status.delete(l);
    },
    onQueue: (l) => {
      list.add(l);
      return () => list.delete(l);
    },
    entries: () => entries,
  });
  return {
    data,
    answers,
    statusEvent: () => status.forEach((l) => l()),
    queueNow: (next: Record<string, number>) => {
      entries = new Map(Object.entries(next));
      list.forEach((l) => l());
    },
    listening: () => status.size + list.size,
  };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe("the graph's data", () => {
  it("fetches when first used and holds the model", async () => {
    const s = source();
    s.data.use();
    expect(s.answers).toHaveLength(1);
    expect(s.data.current().loading).toBe(true);
    s.answers[0]!.resolve(one("A.md"));
    await settle();
    expect(s.data.current()).toMatchObject({ loading: false, error: null });
    expect(s.data.current().model?.nodes.map((n) => n.path)).toEqual(["A.md"]);
  });

  it("fetches again on a status event, one request in flight and one queued", async () => {
    const s = source();
    s.data.use();
    s.statusEvent();
    s.statusEvent();
    s.statusEvent();
    expect(s.answers).toHaveLength(1);
    s.answers[0]!.resolve(one("A.md"));
    await settle();
    // The three events made one more request, sent once the first came back.
    expect(s.answers).toHaveLength(2);
    s.answers[1]!.resolve(one("B.md"));
    await settle();
    expect(s.answers).toHaveLength(2);
    expect(s.data.current().model?.nodes[0]!.path).toBe("B.md");
  });

  it("fetches again when the queue has sent an entry, not when it only holds one", async () => {
    const s = source();
    s.data.use();
    s.answers[0]!.resolve(EMPTY);
    await settle();
    // A change put in the queue is not on the server yet.
    s.queueNow({ "entry:02 People/Mira.md": 0 });
    expect(s.answers).toHaveLength(1);
    s.queueNow({ "entry:02 People/Mira.md": 0, "map:abc": 1 });
    expect(s.answers).toHaveLength(1);
    // Sent: the server gave it a revision.
    s.queueNow({ "entry:02 People/Mira.md": 1 });
    expect(s.answers).toHaveLength(2);
    s.answers[1]!.resolve(EMPTY);
    await settle();
    // Sent and gone.
    s.queueNow({});
    expect(s.answers).toHaveLength(3);
  });

  it("shows what the server has when first used, and fetches again once a waiting entry is sent", async () => {
    const s = source();
    // The tab opens while the queue still holds a change it has not sent.
    s.queueNow({ "entry:02 People/Mira.md": 0 });
    s.data.use();
    expect(s.answers).toHaveLength(1);
    s.answers[0]!.resolve(one("02 People/Mira.md"));
    await settle();
    expect(s.data.current().model?.nodes).toHaveLength(1);
    s.queueNow({ "entry:02 People/Mira.md": 0 });
    expect(s.answers).toHaveLength(1);
    s.queueNow({});
    expect(s.answers).toHaveLength(2);
  });

  it("says the graph needs a connection, unless a graph is already held", async () => {
    const s = source();
    s.data.use();
    s.answers[0]!.reject(new ApiFailure(0, "offline", "Can't reach Frontier."));
    await settle();
    expect(s.data.current()).toMatchObject({ model: null, error: NEEDS_CONNECTION });
    s.data.fetch();
    s.answers[1]!.reject(new ApiFailure(500, "unknown", "Something broke."));
    await settle();
    expect(s.data.current().error).toBe("Something broke.");
    s.data.fetch();
    s.answers[2]!.resolve(one("A.md"));
    await settle();
    s.statusEvent();
    s.answers[3]!.reject(new ApiFailure(0, "offline", "Can't reach Frontier."));
    await settle();
    expect(s.data.current().error).toBeNull();
    expect(s.data.current().model?.nodes).toHaveLength(1);
  });

  it("listens only while something uses it, and fetches again when used again", async () => {
    const s = source();
    const stopA = s.data.use();
    const stopB = s.data.use();
    expect(s.listening()).toBe(2);
    stopA();
    stopA();
    expect(s.listening()).toBe(2);
    stopB();
    expect(s.listening()).toBe(0);
    s.answers[0]!.resolve(EMPTY);
    await settle();
    // The second use found a request in flight and queued one behind it.
    expect(s.answers).toHaveLength(2);
    s.answers[1]!.resolve(EMPTY);
    await settle();
    s.data.use();
    expect(s.answers).toHaveLength(3);
    expect(s.listening()).toBe(2);
  });
});
