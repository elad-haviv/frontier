/**
 * The providers the person making this request can use: those they sent a key for (stage 27f).
 * The server keeps no key of its own, in settings or in its environment; the key comes from the
 * request's header (see `keyring.ts`). Only the addresses can be set on the server, with the
 * `*_BASE_URL` variables, which tests point at stand-in servers.
 */
import { AI_PROVIDER_KINDS, AiProviderKind } from "@frontier/schema";
import type { Config } from "../config.js";
import { deviceKey } from "./keyring.js";
import { DEFAULT_BASE_URL, makeAdapter, type ProviderAdapter } from "./providers/index.js";
import { scrubbing } from "./providers/scrub.js";

export interface ResolvedProvider {
  /** The provider's kind, which is also its id in a model id ("anthropic:claude-…"). */
  id: AiProviderKind;
  kind: AiProviderKind;
  name: string;
  /** The address calls go to. */
  baseUrl: string;
  /** The key of this request. */
  key: string;
}

export type ConnectionsConfig = Pick<Config, "providerUrls">;

const trim = (url: string) => url.replace(/\/+$/, "");

export class Connections {
  private readonly fetch: typeof fetch;

  constructor(
    private readonly d: {
      config: ConnectionsConfig;
      fetch?: typeof fetch;
    },
  ) {
    this.fetch = d.fetch ?? fetch;
  }

  /** Whether `id` is a provider Frontier can call. */
  known(id: string): id is AiProviderKind {
    return AiProviderKind.safeParse(id).success;
  }

  /** The address of a provider: the one the environment gives, else its usual one. */
  baseUrl(kind: AiProviderKind): string {
    return trim(this.d.config.providerUrls[kind] ?? DEFAULT_BASE_URL[kind]);
  }

  private resolve(kind: AiProviderKind, key: string): ResolvedProvider {
    return {
      id: kind,
      kind,
      name: AI_PROVIDER_KINDS[kind].label,
      baseUrl: this.baseUrl(kind),
      key,
    };
  }

  /** Every provider this request carries a key for, in the order the settings page lists them. */
  list(): ResolvedProvider[] {
    const out: ResolvedProvider[] = [];
    for (const kind of AiProviderKind.options) {
      const key = deviceKey(kind);
      if (key) out.push(this.resolve(kind, key));
    }
    return out;
  }

  /** A provider by id, or null when this request has no key for it. */
  get(id: string): ResolvedProvider | null {
    if (!this.known(id)) return null;
    const key = deviceKey(id);
    return key ? this.resolve(id, key) : null;
  }

  /** The adapter for a provider. Every failure's words are scrubbed of the key. */
  adapter(p: Pick<ResolvedProvider, "kind" | "baseUrl"> & { key: string | null }): ProviderAdapter {
    return scrubbing(
      makeAdapter({ kind: p.kind, baseUrl: p.baseUrl, key: p.key, fetch: this.fetch }),
      p.key,
    );
  }

  /** An adapter for a key that is being tried: the request's own key for that provider. */
  trial(kind: AiProviderKind, key: string): ProviderAdapter {
    return this.adapter({ kind, key, baseUrl: this.baseUrl(kind) });
  }
}
