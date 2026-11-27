import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { exportJWK, generateKeyPair, type JWK, SignJWT, type CryptoKey } from "jose";

/** What a test says about the token a stand-in provider hands out. */
export interface Grant {
  sub?: string;
  email?: string;
  email_verified?: boolean | string | undefined;
  name?: string;
  /** The nonce the app sent; a test may put another one to see it refused. */
  nonce?: string;
  iss?: string;
  aud?: string | string[];
  azp?: string;
  /** Seconds from now; negative is already over. */
  expiresIn?: number;
  /** Sign with a key the provider does not publish. */
  wrongKey?: boolean;
}

/** The parts of the app's request to the provider that its answers depend on. */
export interface AuthRequest {
  state: string;
  nonce: string;
  challenge: string;
  redirectUri: string;
  clientId: string;
  params: URLSearchParams;
}

export const CLIENT_ID = "frontier-test-client.apps.example";
export const CLIENT_SECRET = "frontier-test-secret";

/**
 * A stand-in OpenID Connect provider on loopback: a discovery document, a key set, and a token
 * endpoint that checks the client, the redirect address and the PKCE verifier, then hands out an ID
 * token signed as a test asks. A test "visits" the authorization endpoint by reading the app's
 * redirect with `parseAuthRequest`.
 */
export class FakeProvider {
  issuer = "";
  tokenCalls = 0;
  private server!: Server;
  private key!: CryptoKey;
  private other!: CryptoKey;
  private jwk!: JWK;
  private codes = new Map<string, { grant: Grant; request: AuthRequest }>();
  private n = 0;
  /** How many times the key set was fetched, to see that it is cached. */
  jwksFetches = 0;
  /** Makes the token endpoint answer an error, to see the app cope. */
  failToken = false;

  async start(): Promise<this> {
    const pair = await generateKeyPair("RS256", { extractable: true });
    this.key = pair.privateKey;
    this.other = (await generateKeyPair("RS256")).privateKey;
    this.jwk = { ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "RS256", use: "sig" };
    this.server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", this.issuer);
      const json = (status: number, body: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      };
      if (url.pathname === "/.well-known/openid-configuration") {
        return json(200, {
          issuer: this.issuer,
          authorization_endpoint: `${this.issuer}/authorize`,
          token_endpoint: `${this.issuer}/token`,
          jwks_uri: `${this.issuer}/jwks`,
        });
      }
      if (url.pathname === "/jwks") {
        this.jwksFetches++;
        return json(200, { keys: [this.jwk] });
      }
      if (url.pathname === "/token" && req.method === "POST") {
        let body = "";
        req.on("data", (c: Buffer) => (body += c.toString()));
        req.on("end", () => void this.token(new URLSearchParams(body), json));
        return;
      }
      res.writeHead(404).end();
    });
    await new Promise<void>((r) => this.server.listen(0, "127.0.0.1", r));
    const { port } = this.server.address() as { port: number };
    this.issuer = `http://127.0.0.1:${port}`;
    return this;
  }

  stop(): Promise<void> {
    return new Promise((r) => this.server.close(() => r()));
  }

  /** Reads what the app asked of the provider from the address it redirected the browser to. */
  parseAuthRequest(location: string): AuthRequest {
    const url = new URL(location);
    const p = url.searchParams;
    return {
      state: p.get("state") ?? "",
      nonce: p.get("nonce") ?? "",
      challenge: p.get("code_challenge") ?? "",
      redirectUri: p.get("redirect_uri") ?? "",
      clientId: p.get("client_id") ?? "",
      params: p,
    };
  }

  /** The code the browser would bring back after the person agreed, for this request. */
  allow(request: AuthRequest, grant: Grant = {}): string {
    const code = `code-${++this.n}-${Math.random().toString(36).slice(2)}`;
    this.codes.set(code, { grant, request });
    return code;
  }

  private async token(form: URLSearchParams, json: (s: number, b: unknown) => void) {
    this.tokenCalls++;
    const found = this.codes.get(form.get("code") ?? "");
    // A code works once.
    this.codes.delete(form.get("code") ?? "");
    const verifier = form.get("code_verifier") ?? "";
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    if (
      this.failToken ||
      !found ||
      form.get("client_id") !== CLIENT_ID ||
      form.get("client_secret") !== CLIENT_SECRET ||
      form.get("redirect_uri") !== found.request.redirectUri ||
      form.get("grant_type") !== "authorization_code" ||
      challenge !== found.request.challenge
    ) {
      return json(400, { error: "invalid_grant" });
    }
    const g = found.grant;
    const now = Math.floor(Date.now() / 1000);
    const claims: Record<string, unknown> = {
      email: g.email ?? "gwen@example.com",
      email_verified: "email_verified" in g ? g.email_verified : true,
      name: g.name ?? "Gwen Google",
      nonce: g.nonce ?? found.request.nonce,
    };
    if (g.azp) claims.azp = g.azp;
    const jwt = await new SignJWT(claims)
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuer(g.iss ?? this.issuer)
      .setAudience(g.aud ?? CLIENT_ID)
      .setSubject(g.sub ?? "google-subject-1")
      .setIssuedAt(now)
      .setExpirationTime(now + (g.expiresIn ?? 300))
      .sign(g.wrongKey ? this.other : this.key);
    json(200, { id_token: jwt, access_token: "unused", token_type: "Bearer" });
  }
}
