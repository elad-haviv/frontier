/**
 * An OpenAI-compatible endpoint is an address the author types, and the server then calls it with
 * a key. So it must never reach the server's own network: https only, every address the host
 * resolves to must be ordinary public unicast (the check the image fetcher uses), the connection
 * goes to the address checked, and redirects are not followed. Plain http to loopback is allowed
 * only when the tests ask for it (IMAGE_FETCH_ALLOW_LOOPBACK).
 */
import { lookup } from "node:dns/promises";
import { isIP, type LookupFunction } from "node:net";
import { Agent, fetch as undiciFetch } from "undici";
import { mayFetchFrom } from "../../images/fromUrl.js";
import { ProviderError } from "./types.js";

export type ResolveAll = (host: string) => Promise<string[]>;

const resolveAll: ResolveAll = async (host) =>
  (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);

export interface GuardOptions {
  allowLoopback: boolean;
  resolve?: ResolveAll;
}

/** Why an endpoint address may not be used, or null when it may. Checks the URL only. */
export function endpointProblem(address: string, allowLoopback: boolean): string | null {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return "The address is not a web address.";
  }
  if (url.username || url.password) return "The address may not hold a user name or password.";
  if (url.protocol === "https:") return null;
  if (url.protocol === "http:" && allowLoopback) return null;
  return "The address must start with https://.";
}

/** The address to connect to, after the checks; throws a ProviderError when one fails. */
export async function checkEndpoint(address: string, o: GuardOptions): Promise<string> {
  const problem = endpointProblem(address, o.allowLoopback);
  if (problem) throw new ProviderError(problem, false);
  const url = new URL(address);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  let addresses: string[];
  try {
    addresses = isIP(host) ? [host] : await (o.resolve ?? resolveAll)(host);
  } catch {
    addresses = [];
  }
  if (addresses.length === 0) {
    throw new ProviderError(`${url.hostname} could not be found.`, true);
  }
  for (const a of addresses) {
    if (!mayFetchFrom(a, o.allowLoopback)) {
      throw new ProviderError(
        `${url.hostname} is a private or local address, which Frontier does not call.`,
        false,
      );
    }
    // Plain http only ever to loopback, and only in tests.
    if (url.protocol === "http:" && mayFetchFrom(a, false)) {
      throw new ProviderError("The address must start with https://.", false);
    }
  }
  return addresses[0]!;
}

const agents = new Map<string, Agent>();

/** A fetch that checks each request's address first and connects to the address checked. */
export function guardedFetch(f: typeof fetch, o: GuardOptions): typeof fetch {
  return async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    const ip = await checkEndpoint(url, o);
    const key = `${new URL(url).host}|${ip}`;
    let agent = agents.get(key);
    if (!agent) {
      const family = isIP(ip);
      const pinned: LookupFunction = (_host, options, done) => {
        if (options.all) done(null, [{ address: ip, family }]);
        else done(null, ip, family);
      };
      agent = new Agent({ connect: { lookup: pinned } });
      agents.set(key, agent);
    }
    // The pinned agent belongs to the undici package, so its own fetch is used with it; a
    // stand-in fetch (the tests) ignores the dispatcher.
    const send = f === globalThis.fetch ? (undiciFetch as unknown as typeof fetch) : f;
    return send(input, {
      ...init,
      redirect: "manual",
      dispatcher: agent,
    } as unknown as RequestInit);
  };
}
