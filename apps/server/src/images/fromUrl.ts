/**
 * Takes an image from a web address. The server fetches it, so the address must never reach the
 * server's own network: every address the host name resolves to must be ordinary public unicast,
 * none may be the server's own, the connection goes to the address that was checked, only ports
 * 80 and 443 are used, and each redirect is checked again. Only raster images are kept.
 */
import { Resolver } from "node:dns/promises";
import { isIP, type LookupFunction } from "node:net";
import ipaddr from "ipaddr.js";
import sharp from "sharp";
import { Agent, request } from "undici";

export interface FetchLimits {
  /** The whole fetch, redirects and all. */
  ms: number;
  /** Looking up a host name. */
  dnsMs: number;
  bytes: number;
  redirects: number;
}

export const FETCH_LIMITS: FetchLimits = {
  ms: 15_000,
  dnsMs: 3_000,
  bytes: 25 * 1024 * 1024,
  redirects: 3,
};

/** What sharp reads, and the extension each is saved with. SVG is not among them. */
const FORMATS: Record<string, string> = {
  jpeg: ".jpg",
  png: ".png",
  webp: ".webp",
  gif: ".gif",
  avif: ".avif",
};

/** Why a fetch failed, for the server log only. The author is told one plain sentence. */
export class ImageFetchError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "ImageFetchError";
  }
}

/** The address as checked: IPv4-mapped IPv6 is turned back into IPv4 first. */
function normalise(address: string): ipaddr.IPv4 | ipaddr.IPv6 {
  const ip = ipaddr.parse(address);
  return ip.kind() === "ipv6" && (ip as ipaddr.IPv6).isIPv4MappedAddress()
    ? (ip as ipaddr.IPv6).toIPv4Address()
    : ip;
}

/**
 * Whether an address may be fetched from: ordinary public unicast only, so no loopback, private,
 * link-local, carrier-grade NAT, multicast, reserved or tunnelling range. Loopback is allowed
 * only when the tests ask for it.
 */
export function mayFetchFrom(address: string, allowLoopback = false): boolean {
  if (!isIP(address)) return false;
  const range = normalise(address).range();
  return range === "unicast" || (allowLoopback && range === "loopback");
}

export type Resolve = (host: string, signal: AbortSignal) => Promise<string[]>;

/** Looks a host name up with c-ares, which does not wait on the shared thread pool. */
const resolveWithCares =
  (timeoutMs: number): Resolve =>
  async (host, signal) => {
    const resolver = new Resolver({ timeout: timeoutMs, tries: 1 });
    const stop = () => resolver.cancel();
    signal.addEventListener("abort", stop);
    const timer = setTimeout(stop, timeoutMs);
    try {
      const found = await Promise.allSettled([resolver.resolve4(host), resolver.resolve6(host)]);
      return found.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", stop);
    }
  };

export interface ImageFetcherOptions {
  /** The server's own address; the addresses its host has are refused. */
  publicUrl: string;
  allowLoopback?: boolean;
  /** Stands in for DNS in tests. */
  resolve?: Resolve;
  limits?: Partial<FetchLimits>;
}

export interface FetchedImage {
  bytes: Buffer;
  /** The extension of what it is, such as ".png". */
  extension: string;
}

/** The name to keep an image under: the address's last part, cleaned and cut, with its kind. */
export function nameFromUrl(url: URL, extension: string, clean: (name: string) => string): string {
  const last = url.pathname.split("/").filter(Boolean).pop() ?? "";
  let decoded: string;
  try {
    decoded = decodeURIComponent(last);
  } catch {
    decoded = last;
  }
  const stem = clean(decoded)
    .replace(/\.[a-z0-9]{1,5}$/i, "")
    .slice(0, 80)
    .trim();
  return `${stem || "image"}${extension}`;
}

export class ImageFetcher {
  private readonly limits: FetchLimits;
  private readonly resolve: Resolve;
  private readonly allowLoopback: boolean;
  /** The addresses of the server's own host, looked up once at start. */
  private readonly own: Promise<Set<string>>;

  constructor(options: ImageFetcherOptions) {
    this.limits = { ...FETCH_LIMITS, ...options.limits };
    this.resolve = options.resolve ?? resolveWithCares(this.limits.dnsMs);
    this.allowLoopback = options.allowLoopback ?? false;
    this.own = this.addressesOf(new URL(options.publicUrl).hostname).then(
      (list) => new Set(list),
      () => new Set(),
    );
  }

  private async addressesOf(host: string, signal = AbortSignal.timeout(this.limits.dnsMs)) {
    const bare = host.replace(/^\[|\]$/g, "");
    if (isIP(bare)) return [normalise(bare).toString()];
    const found = await this.resolve(bare, signal);
    return found.map((a) => normalise(a).toString());
  }

  /** The address to connect to for a URL, after every check; throws when one fails. */
  private async check(url: URL, signal: AbortSignal): Promise<string> {
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new ImageFetchError("not http or https");
    }
    const port = url.port === "" ? (url.protocol === "https:" ? 443 : 80) : Number(url.port);
    const webPort = port === 80 || port === 443;
    if (!webPort && !this.allowLoopback) throw new ImageFetchError(`port ${port}`);
    const addresses = await this.addressesOf(url.hostname, signal).catch(() => []);
    if (addresses.length === 0) throw new ImageFetchError("the host has no address");
    const own = await this.own;
    for (const address of addresses) {
      if (!mayFetchFrom(address, this.allowLoopback)) {
        throw new ImageFetchError(`${address} is not a public address`);
      }
      if (own.has(address)) throw new ImageFetchError(`${address} is this server's own`);
    }
    // Tests serve on loopback, on whatever port they were given; elsewhere only the web's ports.
    if (!webPort && addresses.some((a) => normalise(a).range() !== "loopback")) {
      throw new ImageFetchError(`port ${port}`);
    }
    return addresses[0]!;
  }

  /** Downloads the image at a web address, or throws an ImageFetchError saying why not. */
  async fetch(address: string): Promise<FetchedImage> {
    const signal = AbortSignal.timeout(this.limits.ms);
    let url = new URL(address);
    for (let hop = 0; ; hop++) {
      const ip = await this.check(url, signal);
      const family = isIP(ip);
      // The connection goes to the address checked, whatever DNS says a moment later; TLS still
      // checks the certificate against the host name.
      const lookup: LookupFunction = (_host, options, done) => {
        if (options.all) done(null, [{ address: ip, family }]);
        else done(null, ip, family);
      };
      const agent = new Agent({ connect: { lookup } });
      try {
        const res = await request(url, {
          dispatcher: agent,
          method: "GET",
          signal,
          headers: { "accept-encoding": "identity", accept: "image/*", "user-agent": "Frontier" },
        }).catch((err: unknown) => {
          throw new ImageFetchError(signal.aborted ? "timed out" : `could not connect: ${err}`);
        });
        if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
          await res.body.dump().catch(() => undefined);
          const location = res.headers["location"];
          if (typeof location !== "string") throw new ImageFetchError("a redirect without a place");
          if (hop >= this.limits.redirects) throw new ImageFetchError("too many redirects");
          url = new URL(location, url);
          continue;
        }
        if (res.statusCode < 200 || res.statusCode > 299) {
          await res.body.dump().catch(() => undefined);
          throw new ImageFetchError(`status ${res.statusCode}`);
        }
        const length = Number(res.headers["content-length"]);
        if (length > this.limits.bytes) {
          res.body.destroy();
          throw new ImageFetchError(`${length} bytes`);
        }
        const bytes = await this.read(res.body, signal);
        const extension = await kindOf(bytes);
        return { bytes, extension };
      } finally {
        void agent.close().catch(() => undefined);
      }
    }
  }

  /** The body, stopped at the size limit. */
  private async read(body: AsyncIterable<Buffer> & { destroy(): void }, signal: AbortSignal) {
    const parts: Buffer[] = [];
    let size = 0;
    try {
      for await (const chunk of body) {
        size += chunk.length;
        if (size > this.limits.bytes) {
          body.destroy();
          throw new ImageFetchError(`over ${this.limits.bytes} bytes`);
        }
        parts.push(chunk);
      }
    } catch (err) {
      if (err instanceof ImageFetchError) throw err;
      throw new ImageFetchError(signal.aborted ? "timed out" : "the body broke off");
    }
    return Buffer.concat(parts);
  }
}

/** The extension for a raster image sharp can read; throws for anything else, SVG included. */
async function kindOf(bytes: Buffer): Promise<string> {
  let format: string | undefined;
  try {
    const meta = await sharp(bytes).metadata();
    format = meta.format === "heif" && meta.compression === "av1" ? "avif" : meta.format;
  } catch {
    throw new ImageFetchError("not an image");
  }
  const extension = format ? FORMATS[format] : undefined;
  if (!extension) throw new ImageFetchError(`a ${format} file`);
  return extension;
}
