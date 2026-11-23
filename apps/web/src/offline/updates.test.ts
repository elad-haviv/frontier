// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QueueRecord } from "../sync/db.ts";
import { CHECK_EVERY_MS, INSTALL_WAIT_MS, Updates } from "./updates.ts";

class FakeWorker extends EventTarget {
  postMessage = vi.fn();
  constructor(public state: ServiceWorkerState = "installing") {
    super();
  }
  become(state: ServiceWorkerState) {
    this.state = state;
    this.dispatchEvent(new Event("statechange"));
  }
}

class FakeRegistration extends EventTarget {
  waiting: FakeWorker | null = null;
  installing: FakeWorker | null = null;
  update = vi.fn(async () => undefined);
  /** A new version is found and starts installing. */
  find(worker = new FakeWorker()) {
    this.installing = worker;
    this.dispatchEvent(new Event("updatefound"));
    return worker;
  }
}

class FakeContainer extends EventTarget {
  /** The page is controlled: this is not the first visit. */
  controller: object | null = {};
  registration = new FakeRegistration();
  register = vi.fn(async () => this.registration);
}

/** A queue whose records the test sets. */
function fakeQueue() {
  const listeners = new Set<() => void>();
  let records: Pick<QueueRecord, "state">[] = [];
  return {
    current: () => records as QueueRecord[],
    subscribeList: (l: () => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    set(states: QueueRecord["state"][]) {
      records = states.map((state) => ({ state }));
      for (const l of listeners) l();
    },
  };
}

function make(
  over: {
    build?: unknown;
    path?: string;
    enabled?: boolean;
    container?: FakeContainer | null;
  } = {},
) {
  const container = over.container === undefined ? new FakeContainer() : over.container;
  const queue = fakeQueue();
  const reload = vi.fn();
  const fetch = vi.fn(async () => new Response(JSON.stringify(over.build ?? { build: "abc" })));
  let now = 1_000_000;
  const updates = new Updates({
    container: (container ?? undefined) as unknown as ServiceWorkerContainer | undefined,
    queue,
    fetch: fetch as unknown as typeof globalThis.fetch,
    reload,
    enabled: over.enabled ?? true,
    win: window,
    doc: document,
    path: () => over.path ?? "/",
    now: () => now,
  });
  return {
    updates,
    container: container!,
    registration: container?.registration ?? new FakeRegistration(),
    queue,
    reload,
    fetch,
    later: (ms: number) => (now += ms),
  };
}

const offered = (u: Updates) => u.current().offer;

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("registering the worker", () => {
  it("registers /sw.js for the whole app once", async () => {
    const { updates, container } = make();
    await updates.register();
    await updates.register();
    expect(container.register).toHaveBeenCalledTimes(1);
    expect(container.register).toHaveBeenCalledWith("/sw.js", { scope: "/" });
  });

  it("does not register on the login page, in development, without workers, or when switched off", async () => {
    for (const over of [
      { path: "/login" },
      { enabled: false },
      { build: { build: "abc", worker: false } },
    ]) {
      const { updates, container } = make(over);
      await updates.register();
      expect(container.register, JSON.stringify(over)).not.toHaveBeenCalled();
    }
    const { updates } = make({ container: null });
    await expect(updates.register()).resolves.toBeUndefined();
  });

  it("registers all the same when build.json cannot be read, as offline", async () => {
    const { updates, container, fetch } = make();
    fetch.mockRejectedValue(new TypeError("Failed to fetch"));
    await updates.register();
    expect(container.register).toHaveBeenCalled();
  });

  it("looks for a new version on focus, at most once a minute", async () => {
    const { updates, registration, later } = make();
    await updates.register();
    window.dispatchEvent(new Event("focus"));
    expect(registration.update).not.toHaveBeenCalled();
    later(CHECK_EVERY_MS);
    window.dispatchEvent(new Event("focus"));
    updates.update();
    expect(registration.update).toHaveBeenCalledTimes(1);
  });
});

describe("the offer of a new version", () => {
  it("shows once a new version waits, and not for the first install", async () => {
    const first = make();
    first.container.controller = null;
    await first.updates.register();
    first.registration.find().become("installed");
    expect(offered(first.updates)).toBe(false);

    const { updates, registration } = make();
    await updates.register();
    expect(offered(updates)).toBe(false);
    registration.find().become("installed");
    expect(offered(updates)).toBe(true);
  });

  it("is hidden while a record is being sent, not for records waiting or needing attention", async () => {
    const { updates, registration, queue } = make();
    registration.waiting = new FakeWorker("installed");
    queue.set(["sending", "waiting"]);
    await updates.register();
    expect(offered(updates)).toBe(false);
    queue.set(["waiting", "attention"]);
    expect(offered(updates)).toBe(true);
    queue.set(["sending"]);
    expect(offered(updates)).toBe(false);
  });

  it("is hidden while an editor has the focus", async () => {
    document.body.innerHTML =
      '<div class="cm-editor"><div class="cm-content" contenteditable="true" tabindex="0"></div></div><button>Reader</button>';
    const { updates, registration } = make();
    registration.waiting = new FakeWorker("installed");
    (document.querySelector(".cm-content") as HTMLElement).focus();
    await updates.register();
    expect(offered(updates)).toBe(false);
    document.querySelector("button")!.focus();
    document.dispatchEvent(new FocusEvent("focusin"));
    expect(offered(updates)).toBe(true);
  });

  it("Later hides it until a newer version is found", async () => {
    const { updates, registration } = make();
    registration.waiting = new FakeWorker("installed");
    await updates.register();
    updates.later();
    expect(offered(updates)).toBe(false);
    registration.find().become("installed");
    expect(offered(updates)).toBe(true);
  });
});

describe("Reload", () => {
  it("asks the waiting version to take over", async () => {
    const { updates, registration, reload } = make();
    const waiting = new FakeWorker("installed");
    registration.waiting = waiting;
    await updates.register();
    await updates.reload();
    expect(waiting.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
    expect(reload).not.toHaveBeenCalled();
  });

  it("waits for an installing version to be installed first", async () => {
    const { updates, registration } = make();
    await updates.register();
    const installing = registration.find();
    const asked = updates.reload();
    await vi.advanceTimersByTimeAsync(2000);
    expect(installing.postMessage).not.toHaveBeenCalled();
    installing.become("installed");
    await asked;
    expect(installing.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
  });

  it("looks for a new version when none is waiting or installing", async () => {
    const { updates, registration } = make();
    await updates.register();
    const asked = updates.reload();
    expect(registration.update).toHaveBeenCalled();
    const found = registration.find();
    found.become("installed");
    await asked;
    expect(found.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
  });

  it("reloads plainly when nothing is installed within ten seconds", async () => {
    const { updates, registration, reload } = make();
    await updates.register();
    const installing = registration.find();
    const asked = updates.reload();
    await vi.advanceTimersByTimeAsync(INSTALL_WAIT_MS);
    await asked;
    expect(reload).toHaveBeenCalledTimes(1);
    expect(installing.postMessage).not.toHaveBeenCalled();
  });

  it("reloads plainly without a registration, as when the worker is switched off", async () => {
    const { updates, reload } = make({ build: { build: "abc", worker: false } });
    await updates.register();
    await updates.reload();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("reloads every tab once when the new version takes over", async () => {
    const { updates, container, reload } = make();
    await updates.register();
    container.dispatchEvent(new Event("controllerchange"));
    container.dispatchEvent(new Event("controllerchange"));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
