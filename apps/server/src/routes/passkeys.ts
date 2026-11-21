/**
 * Passkey login (WebAuthn). The server keeps only the public half of each passkey. The challenge
 * of a ceremony lives in the signed session cookie for five minutes.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { z } from "zod";
import { ApiError } from "../errors.js";
import type { Services } from "../app.js";

const FIVE_MINUTES = 5 * 60 * 1000;
const USER_ID = new TextEncoder().encode("frontier-author");

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");
const unb64 = (text: string) => new Uint8Array(Buffer.from(text, "base64url"));

const RegisterVerify = z.object({ name: z.string().trim().min(1).max(60), response: z.unknown() });
const LoginVerify = z.object({ response: z.object({ id: z.string() }).passthrough() });
const PasswordOff = z.object({ off: z.boolean() });

type Transport = "ble" | "cable" | "hybrid" | "internal" | "nfc" | "smart-card" | "usb";

export function passkeyRoutes(app: FastifyInstance, s: Services): void {
  const origin = new URL(s.config.publicUrl).origin;
  const rpID = new URL(s.config.publicUrl).hostname;

  const remember = (request: FastifyRequest, challenge: string) =>
    request.session.set("challenge", { value: challenge, until: Date.now() + FIVE_MINUTES });

  /** The challenge of the ceremony in progress. It can be used once. */
  function take(request: FastifyRequest): string {
    const stored = request.session.get("challenge");
    request.session.set("challenge", undefined);
    if (!stored || stored.until < Date.now()) {
      throw new ApiError("invalid", "This took too long. Start again.");
    }
    return stored.value;
  }

  app.post("/api/passkeys/register/options", async (request) => {
    const settings = (await s.settings.read())!;
    const options = await generateRegistrationOptions({
      rpName: "Frontier",
      rpID,
      userID: USER_ID,
      userName: "author",
      userDisplayName: "Author",
      attestationType: "none",
      excludeCredentials: settings.passkeys.map((p) => ({
        id: p.id,
        transports: p.transports as Transport[],
      })),
      authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
    });
    remember(request, options.challenge);
    return options;
  });

  app.post("/api/passkeys/register/verify", async (request) => {
    const { name, response } = RegisterVerify.parse(request.body);
    const expectedChallenge = take(request);
    let result;
    try {
      result = await verifyRegistrationResponse({
        response: response as Parameters<typeof verifyRegistrationResponse>[0]["response"],
        expectedChallenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        requireUserVerification: true,
      });
    } catch {
      throw new ApiError("invalid", "The passkey could not be checked. Try again.");
    }
    if (!result.verified || !result.registrationInfo) {
      throw new ApiError("invalid", "The passkey could not be checked. Try again.");
    }
    const { credential } = result.registrationInfo;
    await s.settings.update((now) => ({
      ...now,
      passkeys: [
        ...now.passkeys.filter((p) => p.id !== credential.id),
        {
          id: credential.id,
          publicKey: b64(credential.publicKey),
          counter: credential.counter,
          transports: credential.transports ?? [],
          name,
          addedAt: new Date().toISOString(),
        },
      ],
    }));
    return { ok: true as const };
  });

  app.post("/api/passkeys/login/options", async (request) => {
    const settings = await s.settings.read();
    if (!settings || settings.passkeys.length === 0) {
      throw new ApiError("not_found", "No passkey is registered.");
    }
    const options = await generateAuthenticationOptions({
      rpID,
      userVerification: "required",
      allowCredentials: settings.passkeys.map((p) => ({
        id: p.id,
        transports: p.transports as Transport[],
      })),
    });
    remember(request, options.challenge);
    return options;
  });

  app.post("/api/passkeys/login/verify", async (request) => {
    s.loginLimit.attempt(request.ip);
    const { response } = LoginVerify.parse(request.body);
    const expectedChallenge = take(request);
    const settings = await s.settings.read();
    const passkey = settings?.passkeys.find((p) => p.id === response.id);
    const refused = new ApiError("unauthenticated", "This passkey was not accepted.");
    if (!passkey) throw refused;
    let result;
    try {
      result = await verifyAuthenticationResponse({
        response: response as unknown as Parameters<
          typeof verifyAuthenticationResponse
        >[0]["response"],
        expectedChallenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        requireUserVerification: true,
        credential: {
          id: passkey.id,
          publicKey: unb64(passkey.publicKey),
          counter: passkey.counter,
          transports: passkey.transports as Transport[],
        },
      });
    } catch {
      throw refused;
    }
    if (!result.verified) throw refused;
    const counter = result.authenticationInfo.newCounter;
    await s.settings.update((now) => ({
      ...now,
      passkeys: now.passkeys.map((p) => (p.id === passkey.id ? { ...p, counter } : p)),
    }));
    request.session.set("user", "author");
    request.session.set("method", "passkey");
    return { ok: true as const };
  });

  app.delete("/api/passkeys/:id", async (request) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const settings = (await s.settings.read())!;
    if (settings.passwordOff && settings.passkeys.filter((p) => p.id !== id).length === 0) {
      throw new ApiError(
        "not_allowed",
        "This is your only passkey and the password is switched off. Switch the password on first.",
      );
    }
    await s.settings.update((now) => ({
      ...now,
      passkeys: now.passkeys.filter((p) => p.id !== id),
    }));
    return { ok: true as const };
  });

  app.put("/api/settings/password-off", async (request) => {
    const { off } = PasswordOff.parse(request.body);
    if (off && request.session.get("method") !== "passkey") {
      throw new ApiError(
        "not_allowed",
        "Log in with a passkey first. That shows the passkey works before the password stops working.",
      );
    }
    await s.settings.update((now) => ({ ...now, passwordOff: off }));
    return { ok: true as const };
  });
}
