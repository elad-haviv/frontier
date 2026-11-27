// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import type { PublishPlan } from "@frontier/schema";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DialogProvider } from "../components/Dialogs.tsx";
import { setKeysOwner } from "../aiKeys.ts";
import { setCurrentProject } from "../project.ts";
import { ALPHA, signInWithProjects } from "../testing/switchProject.ts";
import { ConflictPage } from "./Conflict.tsx";

// The text editor is CodeMirror; here it is a plain box that reports what is typed in it.
vi.mock("../components/CodeEditor.tsx", async () => {
  const { createElement: h } = await import("react");
  return {
    CodeEditor: ({ initial, onChange }: { initial: string; onChange?: (t: string) => void }) =>
      h("textarea", {
        "aria-label": "Merged text",
        defaultValue: initial,
        onChange: (e: { target: { value: string } }) => onChange?.(e.target.value),
      }),
  };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Conflict = PublishPlan["conflicts"][number];

const conflict = (over: Partial<Conflict> = {}): Conflict => ({
  draftId: "d1",
  path: "01 Places/Harbor.md",
  reason: "saved_by_other",
  mine: "Harbor, my version.",
  theirs: "Harbor, Wren's version.",
  base: "Harbor.",
  theirsBy: { id: "p1", name: "Wren" },
  theirsAt: "2026-11-27T14:02:00.000Z",
  theirsBlob: "blob-wren",
  ...over,
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const refusal = (code: string, message: string) => json(409, { error: { code, message } });

let host: HTMLDivElement;
let root: Root;
let sent: { url: string; method: string; body: Record<string, unknown> | null }[];
let answers: ((url: string, method: string) => Response | undefined)[];
let landed: { path: string; state: unknown } | null;

beforeEach(async () => {
  await signInWithProjects();
  setCurrentProject(ALPHA);
  sent = [];
  answers = [];
  landed = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      sent.push({
        url,
        method,
        body: typeof init?.body === "string" ? (JSON.parse(init.body) as never) : null,
      });
      for (const answer of answers) {
        const res = answer(url, method);
        if (res) return res;
      }
      return json(200, {});
    }),
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
afterAll(() => {
  setKeysOwner(null);
  setCurrentProject(null);
});

function Landing() {
  const at = useLocation();
  landed = { path: at.pathname, state: at.state };
  return createElement("p", null, "Back at the review");
}

async function open(state: unknown) {
  await act(async () =>
    root.render(
      createElement(
        DialogProvider,
        null,
        createElement(
          MemoryRouter,
          { initialEntries: [{ pathname: "/p/alpha/conflict/d1", state }] },
          createElement(
            Routes,
            null,
            createElement(Route, {
              path: "/p/:project/conflict/:id",
              element: createElement(ConflictPage),
            }),
            createElement(Route, {
              path: "/p/:project/unpublished",
              element: createElement(Landing),
            }),
          ),
        ),
      ),
    ),
  );
}

const radio = (label: string) =>
  [...host.querySelectorAll<HTMLLabelElement>("label.compare-choice")]
    .find((l) => l.textContent?.startsWith(label))!
    .querySelector("input")!;
const button = (label: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === label)!;
const click = (el: Element) =>
  act(async () => el.dispatchEvent(new MouseEvent("click", { bubbles: true })));
const resolves = () => sent.filter((s) => s.url.endsWith("/drafts/d1/resolve"));

describe("the compare screen for a version someone else saved", () => {
  it("shows their text with who and when, mine, and three choices, none chosen yet", async () => {
    await open({ conflict: conflict({ mergedText: "Harbor, both." }), message: "Add a line" });
    expect(host.querySelector("h1")!.textContent).toBe("Compare two versions of Harbor");
    const text = host.textContent!;
    expect(text).toContain("Wren saved this at");
    expect(text).toContain("Mine, not saved yet");
    expect(text).toContain("Harbor, Wren's version.");
    expect(text).toContain("Harbor, my version.");
    for (const label of ["Keep mine", "Keep theirs", "Use the merged text"]) {
      expect(radio(label).checked).toBe(false);
    }
    // Nothing is chosen, so nothing can be sent yet.
    expect(button("Use this choice").disabled).toBe(true);
    expect(resolves()).toHaveLength(0);
    // The screen takes the focus, for a screen reader.
    expect(document.activeElement).toBe(host.querySelector("h1"));
  });

  it("'keep mine' resolves with the person's own text and the version it compared, then carries on with the save", async () => {
    await open({ conflict: conflict(), message: "Add a line" });
    await click(radio("Keep mine"));
    await click(button("Use this choice"));
    expect(resolves()).toHaveLength(1);
    expect(resolves()[0]!.body).toEqual({ text: "Harbor, my version.", theirsBlob: "blob-wren" });
    // Back at the review, which plans again with the line the person had typed.
    expect(landed).toMatchObject({
      path: "/p/alpha/unpublished",
      state: { replan: true, message: "Add a line" },
    });
  });

  it("'keep theirs' asks first, then resolves with theirs", async () => {
    await open({ conflict: conflict() });
    await click(radio("Keep theirs"));
    await click(button("Use this choice"));
    // The question, with the safe answer in reach, before anything is thrown away.
    expect(document.body.textContent).toContain("Keep Wren's version?");
    expect(resolves()).toHaveLength(0);
    await click(button("Keep theirs"));
    await vi.waitFor(() => expect(resolves()).toHaveLength(1));
    expect(resolves()[0]!.body).toEqual({
      text: "Harbor, Wren's version.",
      theirsBlob: "blob-wren",
    });
    expect(landed?.state).toMatchObject({ replan: true });
  });

  it("offers the merged text pre-filled, editable, and resolves with what is in the box", async () => {
    await open({ conflict: conflict({ mergedText: "Harbor, both." }) });
    await click(radio("Use the merged text"));
    const box = host.querySelector<HTMLTextAreaElement>("textarea[aria-label='Merged text']")!;
    expect(box.value).toBe("Harbor, both.");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
        box,
        "Harbor, both, tidied.",
      );
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click(button("Use this choice"));
    expect(resolves()[0]!.body).toEqual({ text: "Harbor, both, tidied.", theirsBlob: "blob-wren" });
  });

  it("starts the combined text from the person's own when the changes cannot be combined, and says so", async () => {
    await open({ conflict: conflict() });
    expect(host.textContent).toContain("Combine them by hand");
    await click(radio("Combine them by hand"));
    expect(host.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe("Harbor, my version.");
  });

  it("is told when they saved again, compares again with the new version, and keeps what the person typed", async () => {
    answers.push((url, method) => {
      if (url.endsWith("/drafts/d1/resolve") && method === "POST") {
        return refusal("saved_by_other", "Rex saved a newer version while you were comparing.");
      }
      if (url.endsWith("/drafts/d1/compare")) {
        return json(200, {
          draftId: "d1",
          path: "01 Places/Harbor.md",
          outcome: "conflict",
          theirsBlob: "blob-rex",
          conflict: conflict({
            theirs: "Harbor, Rex's version.",
            theirsBy: { id: "p3", name: "Rex" },
            theirsBlob: "blob-rex",
          }),
        });
      }
      return undefined;
    });
    await open({ conflict: conflict({ mergedText: "Harbor, both." }) });
    await click(radio("Use the merged text"));
    const box = host.querySelector<HTMLTextAreaElement>("textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
        box,
        "My careful merge.",
      );
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click(button("Use this choice"));
    await vi.waitFor(() =>
      expect(host.textContent).toContain("Rex saved again while you were comparing"),
    );
    // Their new version is shown, nothing was chosen for the person, and they are still here.
    expect(host.textContent).toContain("Harbor, Rex's version.");
    expect(host.textContent).toContain("Rex saved this at");
    expect(landed).toBeNull();
    expect(radio("Keep mine").checked).toBe(false);
    expect(button("Use this choice").disabled).toBe(true);
    // The new version does not combine with theirs on its own, but the text they typed is kept.
    await click(radio("Combine them by hand"));
    expect(host.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe("My careful merge.");
    // The next choice is sent with the new version.
    answers.length = 0;
    await click(radio("Keep mine"));
    await click(button("Use this choice"));
    expect(resolves().at(-1)!.body).toMatchObject({ theirsBlob: "blob-rex" });
    expect(landed).not.toBeNull();
  });

  it("opens from the server when there is no review to come from, and says when nothing differs", async () => {
    answers.push((url) =>
      url.endsWith("/drafts/d1/compare")
        ? json(200, { draftId: "d1", path: "x.md", outcome: "none", theirsBlob: "b" })
        : undefined,
    );
    await open(null);
    await vi.waitFor(() => expect(host.textContent).toContain("Nothing differs"));
  });

  it("says plainly when the change is not there any more", async () => {
    answers.push((url) =>
      url.endsWith("/drafts/d1/compare")
        ? json(404, { error: { code: "not_found", message: "There is no such draft." } })
        : undefined,
    );
    await open(null);
    await vi.waitFor(() => expect(host.textContent).toContain("not here any more"));
  });
});

describe("the older screen for any other clash", () => {
  it("is still the editor with the vault's version beside it, and carries on without replanning", async () => {
    await open({ conflict: conflict({ reason: "overlap", theirsBy: null }) });
    expect(host.querySelector("h1")!.textContent).toBe("Resolve");
    expect(host.textContent).toContain("changed the same lines");
    await click(button("Save as resolved"));
    // The version compared goes with it here too.
    expect(resolves()[0]!.body).toMatchObject({
      text: "Harbor, my version.",
      theirsBlob: "blob-wren",
    });
    expect(landed).toMatchObject({ path: "/p/alpha/unpublished", state: null });
  });

  it("names who deleted an entry, and says the text is kept", async () => {
    await open({
      conflict: conflict({ reason: "deleted_on_main", theirs: null, theirsBlob: null }),
    });
    expect(host.textContent).toContain("Wren deleted this entry");
    expect(host.textContent).toContain("Saving will add it back");
    await click(button("Save as resolved"));
    // "No file" is a null blob, which is not the same as not saying.
    expect(resolves()[0]!.body).toEqual({ text: "Harbor, my version.", theirsBlob: null });
  });
});
