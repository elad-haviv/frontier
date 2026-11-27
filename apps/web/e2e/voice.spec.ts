import { expect, test } from "@playwright/test";
import { setUpAi, at } from "./helpers.ts";

// One test at a time changes the AI settings, which are shared by the whole server.
test.describe.configure({ mode: "serial" });

/** A stand-in for the browser's speech recognition, which the test speaks through. */
const FAKE_SPEECH = () => {
  class Fake {
    continuous = false;
    interimResults = false;
    lang = "";
    onresult: ((e: unknown) => void) | null = null;
    onerror: ((e: unknown) => void) | null = null;
    onend: (() => void) | null = null;
    start() {
      (window as unknown as { __rec: Fake }).__rec = this;
    }
    stop() {
      this.onend?.();
    }
    abort() {}
  }
  // Chromium has both names; the app takes the unprefixed one first.
  Object.assign(window, { SpeechRecognition: Fake, webkitSpeechRecognition: Fake });
};

const say = (page: import("@playwright/test").Page, words: string) =>
  page.evaluate((w) => {
    const rec = (window as unknown as { __rec: { onresult: (e: unknown) => void } }).__rec;
    rec.onresult({ results: [Object.assign([{ transcript: w }], { isFinal: true })] });
  }, words);

interface Unpublished {
  id: string;
  path: string;
  kind: string;
  text: string;
}
/** The drafts this test keeps, found by the entry's name. */
async function ours(page: import("@playwright/test").Page): Promise<Unpublished[]> {
  const res = await page.request.get("/api/unpublished");
  const drafts = (await res.json()).drafts as Unpublished[];
  return drafts.filter((d) => d.path.endsWith("/Harbor Warden.md"));
}
/** Leaves the server as it was found, whatever the test did. */
async function removeOurs(page: import("@playwright/test").Page): Promise<void> {
  for (const d of await ours(page)) {
    const gone = await page.request.delete(`/api/drafts/${d.id}`);
    expect(gone.ok(), await gone.text()).toBe(true);
  }
}

test("dictates an idea, drafts an entry, edits and decides, then keeps it as an unsaved change", async ({
  page,
}) => {
  await page.addInitScript(FAKE_SPEECH);
  await setUpAi(page, { conversation: "sample/reader" });
  await removeOurs(page);
  await page.goto(at("/ask"));

  // Tap to start, tap to stop; the words land in the box and stay editable.
  const box = page.getByLabel("A question or an idea");
  await page.getByRole("button", { name: "Dictate" }).click();
  await expect(page.getByRole("button", { name: "Stop dictation" }).first()).toBeVisible();
  await say(page, "Harbor Warden keeps the lights");
  await expect(box).toHaveValue("Harbor Warden keeps the lights");
  // Nothing is sent while it listens.
  await expect(page.getByRole("button", { name: "Draft entry" })).toBeDisabled();
  await page.getByRole("button", { name: "Stop dictation" }).first().click();
  await expect(page.getByRole("button", { name: "Dictate" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Draft entry" })).toBeEnabled();

  // The draft: a conflicting line stops it being kept until it is decided.
  await page.getByRole("button", { name: "Draft entry" }).click();
  const draft = page.getByRole("region", { name: "Draft entry" });
  await expect(draft.getByLabel("Title")).toHaveValue("Harbor Warden");
  await expect(draft.getByText("Conflicts with the lore")).toBeVisible();
  const keep = draft.getByRole("button", { name: "Keep as unsaved change" });
  await expect(keep).toBeDisabled();
  await expect(draft.getByText("How old is the warden?")).toBeVisible();

  // Ask for a fix: a suggestion shows its changes, and accepting it rechecks the paragraph.
  await draft.getByRole("button", { name: "Fix it for me" }).click();
  await expect(draft.getByText("Suggested change")).toBeVisible();
  await draft.getByRole("button", { name: "Accept" }).click();
  await expect(draft.getByText("Conflicts with the lore")).toHaveCount(0);
  await expect(draft.getByText("Edited by you. Rechecked.")).toBeVisible();
  await expect(keep).toBeEnabled();

  // Edit in place; Undo brings the proposed words back.
  const first = draft.getByLabel("Paragraph 1, editable");
  await first.fill("The warden of the harbour lights, by my own words.");
  await first.blur();
  await expect(draft.getByText("Edited by you. Rechecked.").first()).toBeVisible();

  await keep.click();
  await expect(page.locator(".banner-ok")).toContainText("Kept as an unsaved change");

  // It waits under Unpublished as a new entry, written as edited.
  try {
    await page.goto(at("/unpublished"));
    await expect(page.getByText("Harbor Warden").first()).toBeVisible();
    const mine = (await ours(page))[0]!;
    expect(mine.kind).toBe("create");
    expect(mine.text).toContain("# Harbor Warden");
    expect(mine.text).toContain("The warden of the harbour lights, by my own words.");
    expect(mine.text).not.toContain("kept against the lore");
  } finally {
    await removeOurs(page);
  }
});

test("says so when this browser cannot dictate, and the box still works", async ({ page }) => {
  await page.addInitScript(() => {
    Object.assign(window, { SpeechRecognition: undefined, webkitSpeechRecognition: undefined });
  });
  await setUpAi(page, { conversation: "sample/reader" });
  await page.goto(at("/ask"));
  await expect(page.getByRole("button", { name: "Dictate" })).toHaveCount(0);
  await expect(page.getByText("Dictation is not available in this browser.")).toBeVisible();
  await page.getByLabel("A question or an idea").fill("typed instead");
  await expect(page.getByRole("button", { name: "Draft entry" })).toBeEnabled();
});
