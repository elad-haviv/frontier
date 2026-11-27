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

/** What the server answers to a compare: the clash of the review, unless a test says otherwise. */
const compareOf = (c: Conflict, over: Record<string, unknown> = {}) =>
  json(200, {
    draftId: c.draftId,
    path: c.path,
    outcome: "conflict",
    theirsBlob: c.theirsBlob,
    revision: 1,
    mine: c.mine,
    conflict: { ...c, revision: 1 },
    ...over,
  });

async function open(state: unknown) {
  const given = (state as { conflict?: Conflict } | null)?.conflict;
  if (given) {
    answers.push((url) => (url.endsWith("/drafts/d1/compare") ? compareOf(given) : undefined));
  }
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
    expect(resolves()[0]!.body).toEqual({
      text: "Harbor, my version.",
      theirsBlob: "blob-wren",
      revision: 1,
    });
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
      revision: 1,
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
    expect(resolves()[0]!.body).toEqual({
      text: "Harbor, both, tidied.",
      theirsBlob: "blob-wren",
      revision: 1,
    });
  });

  it("starts the combined text from the person's own when the changes cannot be combined, and says so", async () => {
    await open({ conflict: conflict() });
    expect(host.textContent).toContain("Combine them by hand");
    await click(radio("Combine them by hand"));
    expect(host.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe("Harbor, my version.");
  });

  it("is told when they saved again, compares again with the new version, and keeps what the person typed", async () => {
    let refused = false;
    answers.push((url, method) => {
      if (url.endsWith("/drafts/d1/resolve") && method === "POST") {
        refused = true;
        return refusal("saved_by_other", "Rex saved a newer version while you were comparing.");
      }
      if (url.endsWith("/drafts/d1/compare") && refused) {
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
    expect(resolves()[0]!.body).toEqual({
      text: "Harbor, my version.",
      theirsBlob: null,
      revision: 1,
    });
  });
});

const typeInto = (box: HTMLTextAreaElement, value: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(box, value);
    box.dispatchEvent(new Event("input", { bubbles: true }));
  });

describe("the screen never trusts what the review sent", () => {
  it("compares on opening and keeps mine with the newest text and revision, not the sent ones", async () => {
    // The person kept writing in another tab: the server holds a newer text at revision 4.
    answers.push((url) =>
      url.endsWith("/drafts/d1/compare")
        ? compareOf(conflict(), {
            revision: 4,
            mine: "Harbor, written later.",
            conflict: { ...conflict({ mine: "Harbor, written later." }), revision: 4 },
          })
        : undefined,
    );
    await open({ conflict: conflict({ mine: "Harbor, old text." }) });
    expect(host.textContent).toContain("Harbor, written later.");
    expect(host.textContent).not.toContain("Harbor, old text.");
    await click(radio("Keep mine"));
    await click(button("Use this choice"));
    expect(resolves()[0]!.body).toEqual({
      text: "Harbor, written later.",
      theirsBlob: "blob-wren",
      revision: 4,
    });
  });

  it("cannot choose before the server has answered", async () => {
    answers.push((url) =>
      url.endsWith("/drafts/d1/compare")
        ? json(500, { error: { code: "internal", message: "Down." } })
        : undefined,
    );
    await open({ conflict: conflict() });
    await vi.waitFor(() => expect(host.textContent).toContain("Down."));
    expect(host.textContent).toContain("Harbor, my version.");
    expect(host.querySelector<HTMLFieldSetElement>("fieldset")!.disabled).toBe(true);
  });

  it("says the entry was changed elsewhere on stale_revision, and compares again without choosing", async () => {
    let calls = 0;
    answers.push((url, method) => {
      if (url.endsWith("/drafts/d1/resolve") && method === "POST") {
        return refusal("stale_revision", "This entry was changed elsewhere.");
      }
      if (url.endsWith("/drafts/d1/compare")) {
        calls++;
        return calls === 1
          ? undefined
          : compareOf(conflict(), {
              revision: 2,
              mine: "Harbor, newer.",
              conflict: { ...conflict({ mine: "Harbor, newer." }), revision: 2 },
            });
      }
      return undefined;
    });
    await open({ conflict: conflict() });
    await click(radio("Keep mine"));
    await click(button("Use this choice"));
    await vi.waitFor(() => expect(host.textContent).toContain("changed elsewhere"));
    expect(host.textContent).toContain("Harbor, newer.");
    expect(landed).toBeNull();
    expect(button("Use this choice").disabled).toBe(true);
  });
});

describe("text typed into the merged editor", () => {
  const typed = async () => {
    await click(radio("Use the merged text"));
    await typeInto(host.querySelector("textarea")!, "My careful merge.");
  };

  it("asks before the browser is left, once something was typed, and not before", async () => {
    await open({ conflict: conflict({ mergedText: "Harbor, both." }) });
    const before = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(before);
    expect(before.defaultPrevented).toBe(false);
    await typed();
    const after = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(true);
  });

  it("asks before a link inside the app is followed, and stays when the person says so", async () => {
    await open({ conflict: conflict({ mergedText: "Harbor, both." }) });
    await typed();
    const link = [...host.querySelectorAll("a")].find((a) => a.textContent === "Not now")!;
    await click(link);
    expect(document.body.textContent).toContain("Leave without saving?");
    expect(landed).toBeNull();
    await click(button("Leave"));
    await vi.waitFor(() => expect(landed?.path).toBe("/p/alpha/unpublished"));
  });

  it("is kept with an offer to save it when the clash went away: ready, not 'nothing differs'", async () => {
    let refused = false;
    answers.push((url, method) => {
      if (url.endsWith("/drafts/d1/resolve") && method === "POST" && !refused) {
        refused = true;
        return refusal("saved_by_other", "Rex saved again.");
      }
      if (url.endsWith("/drafts/d1/compare") && refused) {
        return json(200, {
          draftId: "d1",
          path: "01 Places/Harbor.md",
          outcome: "ready",
          theirsBlob: "blob-now",
          revision: 3,
          mine: "Harbor, my version.",
        });
      }
      return undefined;
    });
    await open({ conflict: conflict({ mergedText: "Harbor, both." }) });
    await typed();
    await click(button("Use this choice"));
    await vi.waitFor(() => expect(host.textContent).toContain("Your text is still here"));
    expect(host.textContent).toContain("My careful merge.");
    expect(host.textContent).toContain("can be saved as it is");
    expect(host.textContent).not.toContain("Nothing differs");
    expect(landed).toBeNull();
    await click(button("Save my text as my unsaved change"));
    expect(resolves().at(-1)!.body).toEqual({
      text: "My careful merge.",
      theirsBlob: "blob-now",
      revision: 3,
    });
    await vi.waitFor(() => expect(landed?.path).toBe("/p/alpha/unpublished"));
  });
});
