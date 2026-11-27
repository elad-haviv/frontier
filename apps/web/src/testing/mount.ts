/**
 * Draws a component for a test, inside what the app puts around its pages (a router, the dialogs,
 * toasts and tooltips, and the open project), and gives back what is needed to look at it and to
 * press things. Used by the tests of pages (stage 31c).
 */
import { act, createElement, type ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";
import { DialogProvider } from "../components/Dialogs.tsx";
import { ProjectContext, type ProjectInfo } from "../components/projectContext.ts";
import { TipProvider } from "../components/ui/Tip.tsx";
import { ToastProvider } from "../components/ui/Toast.tsx";

export const JSON_HEADERS = { "content-type": "application/json" };

/** A response the way the server gives one. */
export const answer = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

/** An error the way the server gives one. */
export const failure = (status: number, code: string, message = "", extra = {}): Response =>
  answer({ error: { code, message, ...extra } }, status);

export interface Mounted {
  host: HTMLElement;
  /** Waits for what the page does after it is drawn (reads that answer). */
  settle: () => Promise<void>;
  /** The first element that matches, which must be there. */
  one: <T extends Element = HTMLElement>(selector: string) => T;
  /** The element of `selector` whose text contains `text`, or null. */
  withText: <T extends Element = HTMLElement>(selector: string, text: string) => T | null;
  click: (el: Element) => Promise<void>;
  change: (el: HTMLSelectElement | HTMLInputElement, value: string) => Promise<void>;
  unmount: () => Promise<void>;
}

/** The project of a test, as the app's route gives it. */
export function projectInfo(over: Partial<ProjectInfo> = {}): ProjectInfo {
  return {
    id: "projecta01",
    slug: "alpha",
    name: "Alpha",
    description: "",
    colour: 0,
    role: "owner",
    record: null,
    reload: () => undefined,
    ...over,
  };
}

/** Draws `page` in the app's frame; with `project` null it is drawn outside any project. */
export async function mount(
  page: ReactElement,
  project: ProjectInfo | null = projectInfo(),
  at = "/",
): Promise<Mounted> {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const { createRoot } = await import("react-dom/client");
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const inside = project ? createElement(ProjectContext.Provider, { value: project }, page) : page;
  await act(async () =>
    root.render(
      createElement(
        MemoryRouter,
        { initialEntries: [at] },
        createElement(
          TipProvider,
          null,
          createElement(ToastProvider, null, createElement(DialogProvider, null, inside)),
        ),
      ),
    ),
  );
  const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));
  return {
    host,
    settle,
    one: <T extends Element = HTMLElement>(selector: string): T => {
      const found = host.ownerDocument.querySelector<T>(selector);
      if (!found) throw new Error(`Nothing matches ${selector}`);
      return found;
    },
    withText: <T extends Element = HTMLElement>(selector: string, text: string): T | null =>
      [...host.ownerDocument.querySelectorAll<T>(selector)].find((e) =>
        (e.textContent ?? "").includes(text),
      ) ?? null,
    click: (el) =>
      act(async () => {
        (el as HTMLElement).click();
      }),
    change: (el, value) =>
      act(async () => {
        const proto = el instanceof HTMLSelectElement ? HTMLSelectElement : HTMLInputElement;
        const set = Object.getOwnPropertyDescriptor(proto.prototype, "value")!.set!;
        set.call(el, value);
        el.dispatchEvent(
          new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }),
        );
      }),
    unmount: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

/** Stubs `fetch` with `route(url, method, body)`: a Response, or undefined for a lost connection. */
export function stubServer(
  route: (
    url: string,
    method: string,
    body: unknown,
  ) => Response | undefined | Promise<Response | undefined>,
) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      calls.push({ url, method, body });
      const made = await route(url, method, body);
      if (!made) throw new TypeError("Failed to fetch");
      return made;
    }),
  );
  return calls;
}
