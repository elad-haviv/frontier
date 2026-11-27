import type { LightMyRequestResponse } from "fastify";
import { expect } from "vitest";
import type { TestApp } from "./app.js";

/** One message the memory transport kept. */
export interface Sent {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** The code in the link of a message: `/join/<code>`, `/confirm/<code>` or `/reset/<code>`. */
export function codeIn(message: Sent, kind: "join" | "confirm" | "reset"): string {
  const m = new RegExp(`/${kind}/([A-Za-z0-9_-]{20,})`).exec(message.text);
  expect(m, `no ${kind} link in: ${message.text}`).not.toBeNull();
  return m![1]!;
}

let ip = 0;
/** A request from nobody logged in, from a network address of its own unless one is given. */
export function anon(
  t: Pick<TestApp, "app">,
  method: "GET" | "POST" | "PUT" | "DELETE",
  url: string,
  payload?: unknown,
  headers: Record<string, string> = {},
): Promise<LightMyRequestResponse> {
  return t.app.inject({
    method,
    url,
    headers: { "x-forwarded-for": `10.1.${Math.floor(++ip / 250)}.${ip % 250}`, ...headers },
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
}

/** The mail kept so far, after any that is still going out has gone. */
export async function outbox(t: Pick<TestApp, "server">): Promise<Sent[]> {
  await t.server.mail.settled();
  return (t.server.mail.outbox?.messages ?? []) as Sent[];
}

/** The messages sent to an address. */
export async function mailTo(t: Pick<TestApp, "server">, address: string): Promise<Sent[]> {
  return (await outbox(t)).filter((m) => m.to.toLowerCase() === address.toLowerCase());
}

/** Forgets what was sent, so a test reads only what its own step sent. */
export async function clearMail(t: Pick<TestApp, "server">): Promise<void> {
  await t.server.mail.settled();
  t.server.mail.outbox!.messages.length = 0;
}
