// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import type { StatusSnapshot } from "@frontier/schema";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProjectContext } from "../components/projectContext.ts";
import { connection } from "../sync/connection.ts";
import { othersAt, useOthersLookup, useOthersUnsaved, useReaders } from "./live.ts";
import { OthersNotice } from "./OthersNotice.tsx";
import { ReadingNow } from "./ReadingNow.tsx";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SINCE = "2026-11-27T10:00:00.000Z";
const snapshot = (over: Partial<StatusSnapshot> = {}): StatusSnapshot =>
  ({
    library: "own",
    unpublished: 0,
    othersUnsaved: [{ path: "a.md", people: [{ id: "p1", name: "Wren", since: SINCE }] }],
    presence: [{ id: "p2", name: "Rex", path: "a.md", since: SINCE }],
    ...over,
  }) as StatusSnapshot;

let host: HTMLDivElement;
let root: Root;

/** Sets what the connection service holds, as its stream does. */
const feed = (state: "online" | "offline", snap: StatusSnapshot | null) =>
  (connection as unknown as { set: (s: string, n: StatusSnapshot | null) => void }).set(
    state,
    snap,
  );

const as = (role: "owner" | "writer" | "reader" | null, children: ReactNode) =>
  createElement(
    ProjectContext.Provider,
    {
      value: {
        id: "p1",
        slug: "alpha",
        name: "alpha",
        description: "",
        colour: 0,
        role,
        record: null,
        reload: () => undefined,
      },
    },
    children,
  );

/** What the hooks give for the entry a.md, as JSON in the page. */
function Probe({ stale = false }: { stale?: boolean }) {
  const others = useOthersUnsaved("a.md", undefined, stale);
  const readers = useReaders("a.md", stale);
  const lookup = useOthersLookup();
  return createElement("pre", {
    id: "out",
    children: JSON.stringify({
      others: others.map((o) => o.name),
      readers: readers.map((r) => r.name),
      lookup: lookup === null ? null : lookup === "flags" ? "flags" : [...lookup.keys()],
    }),
  });
}

const out = () => JSON.parse(host.querySelector("#out")!.textContent!);

async function show(node: ReactNode) {
  await act(async () => root.render(node));
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  feed("online", null);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe("the live decorations", () => {
  it("shows others' unsaved changes and who is reading to a writer, from the stream", async () => {
    feed("online", snapshot());
    await show(as("writer", createElement(Probe)));
    expect(out()).toEqual({ others: ["Wren"], readers: ["Rex"], lookup: ["a.md"] });
  });

  it("follows the stream as it changes", async () => {
    feed("online", snapshot());
    await show(as("owner", createElement(Probe)));
    expect(out().others).toEqual(["Wren"]);
    await act(async () => feed("online", snapshot({ othersUnsaved: [], presence: [] })));
    expect(out()).toEqual({ others: [], readers: [], lookup: [] });
  });

  it("shows a reader nothing, even if the stream said something", async () => {
    feed("online", snapshot());
    await show(as("reader", createElement(Probe)));
    expect(out()).toEqual({ others: [], readers: [], lookup: null });
  });

  it("shows nothing while the role is not known", async () => {
    feed("online", snapshot());
    await show(as(null, createElement(Probe)));
    expect(out().others).toEqual([]);
  });

  it("shows nothing while offline, or from an answer the device copy gave", async () => {
    feed("offline", snapshot());
    await show(as("writer", createElement(Probe)));
    expect(out()).toEqual({ others: [], readers: [], lookup: null });
    await act(async () => feed("online", snapshot()));
    await show(as("writer", createElement(Probe, { stale: true })));
    expect(out().others).toEqual([]);
    expect(out().readers).toEqual([]);
  });

  it("says which entries the tree marks, by the stream's list, or by its own flags for an older server", () => {
    const lookup = new Map([["a.md", [{ id: "p1", name: "Wren", since: SINCE }]]]);
    expect(othersAt(lookup, "a.md", false)).toHaveLength(1);
    expect(othersAt(lookup, "b.md", true)).toBeNull();
    expect(othersAt("flags", "b.md", true)).toBe(true);
    expect(othersAt("flags", "b.md", undefined)).toBeNull();
    expect(othersAt(null, "a.md", true)).toBeNull();
  });
});

describe("the notice and who is reading", () => {
  it("names who has unsaved changes and never shows text", async () => {
    await show(createElement(OthersNotice, { people: [{ id: "p1", name: "Wren", since: SINCE }] }));
    const notice = host.querySelector("[data-testid=others-notice]")!;
    expect(notice.textContent).toContain("Wren has unsaved changes to this entry");
    expect(notice.getAttribute("role")).toBe("status");
    // Not the editor: what will happen is not said.
    expect(notice.textContent).not.toContain("saves second");
  });

  it("says in the editor what will happen: whoever saves second compares", async () => {
    await show(
      createElement(OthersNotice, {
        people: [{ id: "p1", name: "Wren", since: SINCE }],
        editing: true,
      }),
    );
    expect(host.textContent).toContain("Whoever saves second compares the two texts");
  });

  it("is nothing for nobody", async () => {
    await show(createElement(OthersNotice, { people: [] }));
    expect(host.querySelector("[data-testid=others-notice]")).toBeNull();
    await show(createElement(ReadingNow, { people: [] }));
    expect(host.querySelector("[data-testid=reading-now]")).toBeNull();
  });

  it("names who is reading, in words as well as initials, so a phone has them too", async () => {
    await show(
      createElement(ReadingNow, {
        people: [
          { id: "p1", name: "Wren Hale" },
          { id: "p2", name: "Rex" },
        ],
      }),
    );
    const line = host.querySelector("[data-testid=reading-now]")!;
    expect(line.textContent).toContain("Wren Hale and Rex are also here");
    expect(line.querySelector("[title='Wren Hale']")).not.toBeNull();
    // The initials are decoration; the words are what is read out.
    expect(line.querySelector(".people-faces")!.getAttribute("aria-hidden")).toBe("true");
  });
});
