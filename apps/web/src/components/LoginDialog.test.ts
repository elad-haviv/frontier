// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { act, createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearMe } from "../me.ts";
import { connection } from "../sync/connection.ts";
import { answer, type Mounted, mount, stubServer } from "../testing/mount.ts";
import { LoginDialog } from "./LoginDialog.tsx";

let mounted: Mounted | null = null;
afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  clearMe();
  vi.unstubAllGlobals();
});

/** The connection is told the session is gone, as after a reset that ended this browser's own. */
async function signedOutAt(path: string): Promise<Mounted> {
  stubServer((url) =>
    url.startsWith("/api/session") ? answer({ passkeys: false, password: true }) : answer({}, 401),
  );
  mounted = await mount(createElement(LoginDialog), null, path);
  await act(async () => void (await connection.probe()));
  await mounted.settle();
  return mounted;
}

describe("the login dialog and the reset page", () => {
  it("is not opened over the reset page by the 401 its own reset causes", async () => {
    const m = await signedOutAt("/reset/abc");
    expect(connection.state).toBe("signed-out");
    expect(m.host.ownerDocument.body.textContent).not.toContain("Log in again");
  });

  it("is opened by the same 401 on any other page", async () => {
    const m = await signedOutAt("/projects");
    expect(m.host.ownerDocument.body.textContent).toContain("Log in again");
  });
});
