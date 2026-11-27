// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { act, createElement, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectContext } from "./projectContext.ts";
import { type Mounted, mount, projectInfo } from "../testing/mount.ts";
import { NewEntry } from "./NewEntry.tsx";

let mounted: Mounted | null = null;
afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
});

describe("the New entry dialog", () => {
  it("closes by itself when the person is made a reader while it is open", async () => {
    const onClose = vi.fn();
    let demote: () => void = () => undefined;
    function Page() {
      const [role, setRole] = useState<"writer" | "reader">("writer");
      demote = () => setRole("reader");
      return createElement(
        ProjectContext.Provider,
        { value: projectInfo({ role }) },
        createElement(NewEntry, {
          tree: { state: "loading" },
          folder: "",
          onMake: () => undefined,
          onRetry: () => undefined,
          onClose,
        }),
      );
    }
    mounted = await mount(createElement(Page), null);
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => demote());
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
