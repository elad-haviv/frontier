/**
 * The browser tests' `test`: the same as Playwright's, and every page it makes knows the address
 * of the sample project's calls as the global `API` (`/api/p/sample`). The tests' own `fetch`
 * calls inside the page use it; the ones made from the test itself use `api()` in `helpers.ts`.
 * No test calls an unprefixed project address, which only a previous build of the app would.
 */
import { test as base } from "@playwright/test";
import { api } from "./helpers.ts";

export * from "@playwright/test";

export const test = base.extend({
  context: async ({ context }, use) => {
    await context.addInitScript(`globalThis.API = ${JSON.stringify(api(""))};`);
    await use(context);
  },
});
