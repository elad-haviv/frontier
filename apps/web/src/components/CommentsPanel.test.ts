// @vitest-environment happy-dom
import { act, createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PassageComment } from "../api.ts";
import { setCurrentProject } from "../project.ts";
import { ALPHA } from "../testing/switchProject.ts";
import { answer, type Mounted, mount, projectInfo, stubServer } from "../testing/mount.ts";
import { CommentsPanel } from "./CommentsPanel.tsx";

let mounted: Mounted | null = null;
afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  setCurrentProject(null);
  vi.unstubAllGlobals();
});

const person = (id: string, name: string, role: "owner" | "writer" | "reader" | null) => ({
  id,
  name,
  role,
});
const RHEA = person("r", "Rhea Reader", "reader");
const WREN = person("w", "Wren Writer", "writer");

const thread = (over: Partial<PassageComment> = {}): PassageComment => ({
  id: "aaaaaaaaaaaa",
  path: "Quay.md",
  quote: "",
  prefix: "",
  suffix: "",
  text: "Since when?",
  for: "me",
  legacy: false,
  at: new Date().toISOString(),
  editedAt: null,
  author: RHEA,
  resolved: null,
  replies: [],
  can: { edit: false, delete: false, resolve: false, hand: false, share: false },
  ...over,
});

async function show(comments: PassageComment[], props: Record<string, unknown> = {}) {
  setCurrentProject(ALPHA);
  const changed = vi.fn();
  mounted = await mount(
    createElement(CommentsPanel, {
      view: null,
      text: "The oldest stretch.",
      path: "Quay.md",
      comments,
      adding: null,
      canAi: false,
      onChanged: changed,
      onClose: () => undefined,
      ...props,
    }),
    projectInfo({ role: "reader" }),
  );
  return { m: mounted, changed };
}

const button = (m: Mounted, name: string) =>
  [...m.host.querySelectorAll("button")].find(
    (b) => b.getAttribute("aria-label") === name || b.textContent === name,
  ) ?? null;

describe("the comments panel", () => {
  it("says there are no comments, and offers a comment on the whole entry", async () => {
    const { m } = await show([], { onStart: () => undefined });
    expect(m.host.textContent).toContain("No comments yet.");
    expect(button(m, "Comment on the whole entry")).not.toBeNull();
  });

  it("shows who wrote each comment and reply, their role, the time, and the edited mark", async () => {
    const { m } = await show([
      thread({
        editedAt: new Date().toISOString(),
        replies: [
          {
            id: "bbbbbbbbbbbb",
            text: "Harbor says the council.",
            at: new Date().toISOString(),
            editedAt: null,
            author: WREN,
            can: { edit: false, delete: false },
          },
        ],
      }),
    ]);
    const text = m.host.textContent!;
    expect(text).toContain("Rhea Reader");
    expect(text).toContain("Reader");
    expect(text).toContain("just now");
    expect(text).toContain("edited");
    expect(text).toContain("Wren Writer");
    expect(text).toContain("Harbor says the council.");
    expect(m.host.querySelector('[aria-label="Comments"]')).not.toBeNull();
  });

  it("offers Edit and Delete only where the server says they are allowed, and Resolve likewise", async () => {
    const { m } = await show([thread()]);
    expect(button(m, "Edit your comment")).toBeNull();
    expect(button(m, "Delete Rhea Reader's comment")).toBeNull();
    expect(button(m, "Resolve the comment by Rhea Reader")).toBeNull();
    expect(button(m, "Reply to Rhea Reader")).not.toBeNull();
    await m.unmount();
    mounted = null;
    const again = await show([
      thread({ can: { edit: true, delete: true, resolve: true, hand: false, share: false } }),
    ]);
    expect(button(again.m, "Edit your comment")).not.toBeNull();
    expect(button(again.m, "Delete Rhea Reader's comment")).not.toBeNull();
    expect(button(again.m, "Resolve the comment by Rhea Reader")).not.toBeNull();
  });

  it("sends a reply with Ctrl+Enter, and Escape closes the box without sending", async () => {
    const calls = stubServer(() => answer({ comment: thread() }));
    const { m, changed } = await show([thread()]);
    await m.click(button(m, "Reply to Rhea Reader")!);
    const box = m.one<HTMLTextAreaElement>('textarea[aria-label="Reply to Rhea Reader"]');
    const type = (value: string) =>
      act(async () => {
        const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
        set.call(box, value);
        box.dispatchEvent(new Event("input", { bubbles: true }));
      });
    await type("Thanks, fixing it");
    await act(async () => {
      box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(calls).toHaveLength(0);
    await act(async () => {
      box.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }),
      );
    });
    await m.settle();
    expect(calls).toEqual([
      expect.objectContaining({ method: "POST", body: { text: "Thanks, fixing it" } }),
    ]);
    expect(calls[0]!.url).toContain("/comments/aaaaaaaaaaaa/replies");
    expect(changed).toHaveBeenCalled();
    // Escape on a fresh box leaves it.
    await m.click(button(m, "Reply to Rhea Reader")!);
    const fresh = m.one<HTMLTextAreaElement>('textarea[aria-label="Reply to Rhea Reader"]');
    await act(async () => {
      fresh.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(m.host.querySelector('textarea[aria-label="Reply to Rhea Reader"]')).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it("keeps resolved threads under a toggle, with who resolved and a Reopen", async () => {
    const { m } = await show([
      thread({
        resolved: { by: WREN, at: new Date().toISOString() },
        can: { edit: false, delete: false, resolve: true, hand: false, share: false },
      }),
    ]);
    expect(m.host.textContent).not.toContain("Since when?");
    await m.click(button(m, "Show resolved (1)")!);
    expect(m.host.textContent).toContain("Since when?");
    expect(m.host.textContent).toContain("Resolved by Wren Writer");
    expect(button(m, "Reopen the comment by Rhea Reader")).not.toBeNull();
  });

  it("starts a comment on the whole entry and shows the server's reason when it is refused", async () => {
    stubServer(() =>
      answer({ error: { code: "invalid", message: "This entry is not saved yet." } }, 400),
    );
    const { m } = await show([], { adding: { quote: "", prefix: "", suffix: "" } });
    expect(m.host.textContent).toContain("On the whole entry");
    const box = m.one<HTMLTextAreaElement>('textarea[aria-label="Your comment"]');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
        box,
        "Hello",
      );
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await m.click(button(m, "Keep the comment")!);
    await m.settle();
    expect(m.one('[role="alert"]').textContent).toContain("not saved yet");
    // A reader is not offered a comment for the AI.
    expect(m.host.textContent).not.toContain("For the AI");
  });

  it("marks an old comment as writers-only and offers Share with everyone only where allowed", async () => {
    const calls = stubServer(() => answer({ comment: thread({ legacy: false }) }));
    const old = thread({
      legacy: true,
      can: { edit: false, delete: false, resolve: true, hand: false, share: true },
    });
    const { m, changed } = await show([old]);
    expect(m.host.textContent).toContain("from before sharing: writers only");
    await m.click(button(m, "Share with everyone")!);
    await m.settle();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain("/comments/aaaaaaaaaaaa/share");
    expect(changed).toHaveBeenCalled();
    await m.unmount();
    mounted = null;
    const other = await show([thread({ legacy: true })]);
    expect(other.m.host.textContent).toContain("from before sharing: writers only");
    expect(button(other.m, "Share with everyone")).toBeNull();
  });

  it("says why an old comment cannot be shared", async () => {
    stubServer(() =>
      answer(
        { error: { code: "invalid", message: "That passage is not in the saved entry." } },
        400,
      ),
    );
    const { m } = await show([
      thread({
        legacy: true,
        can: { edit: false, delete: false, resolve: true, hand: false, share: true },
      }),
    ]);
    await m.click(button(m, "Share with everyone")!);
    await m.settle();
    expect(m.one('[role="alert"]').textContent).toContain("not in the saved entry");
  });
});
