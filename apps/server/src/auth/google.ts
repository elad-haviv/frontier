import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createRemoteJWKSet, errors as joseErrors, jwtVerify } from "jose";
import { z } from "zod";
import { GOOGLE_ISSUER, type Config } from "../config.js";

/**
 * Sign-on with Google: OpenID Connect, authorization code flow with PKCE, done on the server.
 * Google only says who someone is (a stable subject, a verified email, a name); every decision
 * about accounts is made by the routes (`routes/google.ts`). The pieces here:
 *
 * - `begin` makes the address to send the browser to, with a random `state`, `nonce` and PKCE
 *   verifier, which the caller keeps in the browser's signed session.
 * - `complete` trades the code for an ID token and verifies it: the signature against Google's
 *   published keys (cached), `iss`, `aud` (this client), `exp`, the `nonce`, and `email_verified`.
 *
 * The provider's endpoints come from its discovery document, which tests point at a stand-in
 * (`GOOGLE_ISSUER`). Nothing here logs a code, a token or a secret.
 */

const DISCOVERY_TTL_MS = 60 * 60 * 1000;
const TIMEOUT_MS = 8000;

const Discovery = z.object({
  issuer: z.string(),
  authorization_endpoint: z.string().url(),
  token_endpoint: z.string().url(),
  jwks_uri: z.string().url(),
});
type Discovery = z.infer<typeof Discovery>;

const TokenResponse = z.object({ id_token: z.string().min(1) });

/** What Google says about the person, once the token has been checked. */
export interface GoogleProfile {
  subject: string;
  email: string;
  name: string;
}

/** Why a sign-in could not be completed; the routes turn it into a page-friendly problem. */
export class GoogleError extends Error {
  constructor(
    readonly reason: "failed" | "unverified",
    message: string,
  ) {
    super(message);
    this.name = "GoogleError";
  }
}

export interface Begun {
  /** Where to send the browser. */
  url: string;
  state: string;
  nonce: string;
  verifier: string;
}

const sha256url = (text: string) => createHash("sha256").update(text).digest("base64url");

/** Whether two secrets are equal, in constant time. */
export function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export class GoogleSignOn {
  /** The address Google sends the browser back to; it must be registered exactly so. */
  readonly redirectUri: string;
  private discovered: {
    at: number;
    doc: Discovery;
    keys: ReturnType<typeof createRemoteJWKSet>;
  } | null = null;

  constructor(
    private readonly google: NonNullable<Config["google"]>,
    publicUrl: string,
    private readonly now: () => number = Date.now,
  ) {
    this.redirectUri = `${publicUrl.replace(/\/+$/, "")}/api/auth/google/callback`;
  }

  /** The provider's endpoints and keys, read from its discovery document and kept for an hour. */
  private async provider() {
    const held = this.discovered;
    if (held && this.now() - held.at < DISCOVERY_TTL_MS) return held;
    try {
      const res = await fetch(`${this.google.issuer}/.well-known/openid-configuration`, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`discovery answered ${res.status}`);
      const doc = Discovery.parse(await res.json());
      // The document must be the issuer's own, or a different provider could stand in.
      if (doc.issuer !== this.google.issuer) throw new Error("discovery names another issuer");
      const made = {
        at: this.now(),
        doc,
        // The keys are fetched when needed, cached for ten minutes, and fetched again when a token
        // names a key that is not held (Google rotates them), at most once every 30 seconds.
        keys: createRemoteJWKSet(new URL(doc.jwks_uri), {
          timeoutDuration: TIMEOUT_MS,
          cooldownDuration: 30_000,
          cacheMaxAge: 10 * 60 * 1000,
        }),
      };
      this.discovered = made;
      return made;
    } catch (err) {
      // An old document is better than none while the provider is briefly unreachable.
      if (held) return held;
      throw new GoogleError(
        "failed",
        `Google's discovery document could not be read: ${String(err)}`,
      );
    }
  }

  async begin(): Promise<Begun> {
    const { doc } = await this.provider();
    const state = randomBytes(24).toString("base64url");
    const nonce = randomBytes(24).toString("base64url");
    const verifier = randomBytes(32).toString("base64url");
    const url = new URL(doc.authorization_endpoint);
    url.search = new URLSearchParams({
      response_type: "code",
      client_id: this.google.clientId,
      redirect_uri: this.redirectUri,
      scope: "openid email profile",
      state,
      nonce,
      code_challenge: sha256url(verifier),
      code_challenge_method: "S256",
      prompt: "select_account",
    }).toString();
    return { url: url.toString(), state, nonce, verifier };
  }

  /** Trades the code for the person's identity, or throws a `GoogleError`. */
  async complete(code: string, verifier: string, nonce: string): Promise<GoogleProfile> {
    const { doc, keys } = await this.provider();
    let idToken: string;
    try {
      const res = await fetch(doc.token_endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          accept: "application/json",
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: this.redirectUri,
          client_id: this.google.clientId,
          client_secret: this.google.clientSecret,
          code_verifier: verifier,
        }).toString(),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`the token endpoint answered ${res.status}`);
      idToken = TokenResponse.parse(await res.json()).id_token;
    } catch (err) {
      throw new GoogleError("failed", `The code could not be exchanged: ${String(err)}`);
    }

    let payload;
    try {
      ({ payload } = await jwtVerify(idToken, keys, {
        // Google writes its issuer with or without the scheme.
        issuer:
          this.google.issuer === GOOGLE_ISSUER
            ? [GOOGLE_ISSUER, "accounts.google.com"]
            : this.google.issuer,
        audience: this.google.clientId,
        algorithms: ["RS256"],
        requiredClaims: ["exp", "iat", "sub"],
        clockTolerance: 60,
      }));
    } catch (err) {
      const why = err instanceof joseErrors.JOSEError ? err.code : "unreadable";
      throw new GoogleError("failed", `The ID token was not accepted (${why}).`);
    }
    // More than one audience: the token must say it was made for this client.
    if (
      Array.isArray(payload.aud) &&
      payload.aud.length > 1 &&
      payload.azp !== this.google.clientId
    ) {
      throw new GoogleError("failed", "The ID token was made for another client.");
    }
    if (typeof payload.nonce !== "string" || !sameSecret(payload.nonce, nonce)) {
      throw new GoogleError("failed", "The ID token's nonce is not the one asked for.");
    }
    const email = typeof payload.email === "string" ? payload.email.trim() : "";
    // Only an email Google has verified says anything about who the person is.
    if (payload.email_verified !== true || email === "") {
      throw new GoogleError("unverified", "Google has not verified this email.");
    }
    const name = typeof payload.name === "string" ? payload.name.trim() : "";
    return {
      subject: String(payload.sub),
      email,
      // The same length a name may have when typed.
      name: (name || email.split("@")[0] || email).slice(0, 80),
    };
  }
}

/**
 * A `returnTo` that cannot send the browser anywhere but this app: a path that starts with one
 * slash, with no scheme, no host, no backslash or control character. Anything else is dropped.
 */
/** Whether a text holds a backslash or a control character (never in an address we send people to). */
const hasUnsafeCharacter = (text: string): boolean =>
  [...text].some((c) => c === "\\" || c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f);

export function safeReturnTo(raw: string | undefined | null): string | null {
  if (!raw || raw.length > 500) return null;
  if (!raw.startsWith("/") || raw.startsWith("//") || hasUnsafeCharacter(raw)) return null;
  try {
    // An encoded backslash or control character is no safer than a plain one.
    if (hasUnsafeCharacter(decodeURIComponent(raw))) return null;
    // Whatever the address parses as against a made-up host must still be that host.
    const parsed = new URL(raw, "http://frontier.invalid");
    if (parsed.origin !== "http://frontier.invalid") return null;
    // Not the API: a browser navigating to one would show raw JSON.
    if (parsed.pathname === "/api" || parsed.pathname.startsWith("/api/")) return null;
    const kept = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    // Dot segments can collapse into a double slash ("/.//host"), which a browser reads as a host.
    return kept.startsWith("//") ? null : kept;
  } catch {
    return null;
  }
}
