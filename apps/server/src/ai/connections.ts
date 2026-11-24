/**
 * The providers the author connected, with their keys read. Keys are decrypted here, on the
 * server, and leave it only as a masked hint.
 */
import {
  AI_PROVIDER_KINDS,
  type AiProviderEntry,
  type AiProviderKind,
  type AiProviderView,
  type AiTaskName,
  type ProviderCheck,
  splitModelId,
} from "@frontier/schema";
import type { Config } from "../config.js";
import { decrypt } from "../state/secrets.js";
import type { SettingsStore } from "../state/settings.js";
import { guardedFetch, type ResolveAll } from "./providers/guard.js";
import { DEFAULT_BASE_URL, makeAdapter, type ProviderAdapter } from "./providers/index.js";
import { scrubbing } from "./providers/scrub.js";

export interface ResolvedProvider {
  id: string;
  kind: AiProviderKind;
  name: string;
  /** The address the stored entry gives, if any. Calls to it go through the address guard. */
  storedBaseUrl: string | null;
  /** The address calls go to; null for an endpoint whose address is not set. */
  baseUrl: string | null;
  enabled: boolean;
  key: string | null;
  keyFrom: "settings" | "environment" | "none";
  /** A key is stored but cannot be decrypted with this SECRETS_KEY. */
  keyUnreadable: boolean;
  stored: boolean;
  check: ProviderCheck | null;
}

/** A key shown without giving it away: its usual prefix and its last four characters. */
export function maskKey(key: string): string {
  const k = key.trim();
  if (k.length < 12) return "…" + k.slice(-2);
  const prefix = /^[A-Za-z]{2,4}[-_]/.exec(k)?.[0] ?? "";
  return `${prefix}…${k.slice(-4)}`;
}

export type ConnectionsConfig = Pick<
  Config,
  "secretsKey" | "openrouterKey" | "openrouterUrl" | "providerEnv" | "imageFetchAllowLoopback"
>;

const trim = (url: string) => url.replace(/\/+$/, "");

/** The built-in kinds whose key can come from the server's environment. */
const ENV_KINDS = ["openrouter", "anthropic", "openai", "google", "xai"] as const;

export class Connections {
  private readonly fetch: typeof fetch;

  constructor(
    private readonly d: {
      config: ConnectionsConfig;
      settings: SettingsStore;
      fetch?: typeof fetch;
      /** Stands in for DNS in tests. */
      resolve?: ResolveAll;
    },
  ) {
    this.fetch = d.fetch ?? fetch;
  }

  private envOf(kind: AiProviderKind): { key: string | null; url: string | null } {
    if (kind === "openrouter") {
      return { key: this.d.config.openrouterKey, url: this.d.config.openrouterUrl };
    }
    const env = (
      this.d.config.providerEnv as Record<
        string,
        { key: string | null; url: string | null } | undefined
      >
    )[kind];
    return env ?? { key: null, url: null };
  }

  private resolve(
    entry: AiProviderEntry | null,
    kind: AiProviderKind,
    id: string,
  ): ResolvedProvider {
    const env = this.envOf(kind);
    let key: string | null = null;
    let keyFrom: ResolvedProvider["keyFrom"] = "none";
    let keyUnreadable = false;
    if (entry?.key) {
      key = this.d.config.secretsKey ? decrypt(this.d.config.secretsKey, entry.key) : null;
      if (key) keyFrom = "settings";
      else keyUnreadable = true;
    }
    if (!key && env.key) {
      key = env.key;
      keyFrom = "environment";
    }
    const base = entry?.baseUrl ?? env.url ?? (kind === "custom" ? null : DEFAULT_BASE_URL[kind]);
    return {
      id,
      kind,
      name: entry?.name ?? AI_PROVIDER_KINDS[kind].label,
      storedBaseUrl: entry?.baseUrl ?? null,
      baseUrl: base ? trim(base) : null,
      enabled: entry?.enabled ?? true,
      key,
      keyFrom,
      keyUnreadable,
      stored: entry !== null,
      check: entry?.check ?? null,
    };
  }

  /** Every provider: the stored ones, then those known only from the environment. */
  async list(): Promise<ResolvedProvider[]> {
    const stored = (await this.d.settings.read())?.ai.providers ?? [];
    const out = stored.map((e) => this.resolve(e, e.kind, e.id));
    for (const kind of ENV_KINDS) {
      if (out.some((p) => p.id === kind)) continue;
      if (this.envOf(kind).key) out.push(this.resolve(null, kind, kind));
    }
    return out;
  }

  async get(id: string): Promise<ResolvedProvider | null> {
    return (await this.list()).find((p) => p.id === id) ?? null;
  }

  /** Whether calls can be made: switched on, with an address, and a key where one is needed. */
  usable(p: ResolvedProvider): boolean {
    return (
      p.enabled && p.baseUrl !== null && (p.key !== null || !AI_PROVIDER_KINDS[p.kind].keyRequired)
    );
  }

  /**
   * The adapter for a provider. An address the author typed goes through the address guard; one
   * from the server's environment or a provider's usual one does not need to.
   */
  adapter(
    p: Pick<ResolvedProvider, "kind" | "baseUrl" | "key" | "storedBaseUrl">,
  ): ProviderAdapter {
    const typed = p.storedBaseUrl !== null || p.kind === "custom";
    const f = typed
      ? guardedFetch(this.fetch, {
          allowLoopback: this.d.config.imageFetchAllowLoopback,
          ...(this.d.resolve ? { resolve: this.d.resolve } : {}),
        })
      : this.fetch;
    return scrubbing(
      makeAdapter({ kind: p.kind, baseUrl: p.baseUrl ?? "", key: p.key, fetch: f }),
      p.key,
    );
  }

  /** An adapter for a key that is being tried before it is saved. */
  trial(kind: AiProviderKind, key: string | null, baseUrl: string | null): ProviderAdapter {
    const env = this.envOf(kind);
    const base = baseUrl ?? env.url ?? (kind === "custom" ? "" : DEFAULT_BASE_URL[kind]);
    return this.adapter({ kind, key, baseUrl: trim(base), storedBaseUrl: baseUrl });
  }

  async view(p: ResolvedProvider): Promise<AiProviderView> {
    const models = (await this.d.settings.read())?.ai.models;
    const usedFor = (["extraction", "conversation", "art"] as AiTaskName[]).filter((t) => {
      const id = models?.[t];
      return id ? splitModelId(id).provider === p.id : false;
    });
    return {
      id: p.id,
      kind: p.kind,
      name: p.name,
      baseUrl: p.storedBaseUrl,
      enabled: p.enabled,
      keySet: p.key !== null,
      keyFrom: p.keyFrom,
      keyHint: p.key ? maskKey(p.key) : null,
      keyUnreadable: p.keyUnreadable,
      stored: p.stored,
      check: p.check,
      usedFor,
    };
  }
}
