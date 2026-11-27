// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { type SlugCheck, useSlugCheck } from "./useSlugCheck.ts";

afterEach(() => vi.unstubAllGlobals());

/** Renders the hook and gives the latest answer. */
async function render(slug: string) {
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  let latest: SlugCheck | null = null;
  function Show() {
    latest = useSlugCheck(slug);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  await act(async () => root.render(createElement(Show)));
  return {
    get: () => latest!,
    act,
    unmount: () => act(async () => root.unmount()),
  };
}

describe("the address check", () => {
  it("says the address could not be checked when the server cannot be asked, and asks again on request", async () => {
    let up = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        if (!up) throw new TypeError("Failed to fetch");
        return new Response(JSON.stringify({ free: true, reason: null }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );
    const view = await render("north");
    expect(view.get().state).toBe("checking");
    // Not "checking" for ever: once the question fails it is unknown, and can be asked again.
    await vi.waitFor(() => expect(view.get().state).toBe("unknown"), { timeout: 2000 });
    expect(view.get().words).toMatch(/could not be checked/);

    up = true;
    await view.act(async () => view.get().retry());
    await vi.waitFor(() => expect(view.get().state).toBe("free"), { timeout: 2000 });
    await view.unmount();
  });
});
