// @vitest-environment happy-dom
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type Mounted, mount } from "../testing/mount.ts";
import { useCopyText } from "./CopyText.tsx";

let mounted: Mounted | null = null;
afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  vi.unstubAllGlobals();
});

const setClipboard = (clipboard: unknown) =>
  Object.defineProperty(navigator, "clipboard", { value: clipboard, configurable: true });

function Button() {
  const { copy, box } = useCopyText("Harbor");
  return createElement(
    "div",
    null,
    createElement("button", { onClick: () => void copy("The text\nof Harbor") }, "Copy"),
    box,
  );
}

describe("copying a text out", () => {
  it("copies it when the browser allows", async () => {
    const writeText = vi.fn(async () => undefined);
    setClipboard({ writeText });
    mounted = await mount(createElement(Button), null);
    await mounted.click(mounted.one("button"));
    expect(writeText).toHaveBeenCalledWith("The text\nof Harbor");
    expect(mounted.host.querySelector("textarea")).toBeNull();
  });

  it("shows the text in a read-only box, selected, when the clipboard is refused", async () => {
    setClipboard({
      writeText: async () => {
        throw new DOMException("denied", "NotAllowedError");
      },
    });
    mounted = await mount(createElement(Button), null);
    await mounted.click(mounted.one("button"));
    await mounted.settle();
    const box = mounted.one<HTMLTextAreaElement>("textarea");
    expect(box.readOnly).toBe(true);
    expect(box.value).toBe("The text\nof Harbor");
    expect(document.activeElement).toBe(box);
    expect(box.selectionStart).toBe(0);
    expect(box.selectionEnd).toBe(box.value.length);
  });
});
