/**
 * Passkey login (WebAuthn). The server keeps only the public half of each passkey, with the
 * person it belongs to; a login finds the person from the credential. The challenge of a
 * ceremony lives in the signed session cookie for five minutes.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { z } from "zod";
import {
  endOtherSessions,
  followEpoch,
  personOf,
  requireRecentLogin,
  startSession,
} from "../auth/session.js";
import { ApiError } from "../errors.js";
import { PUBLIC } from "../auth/openness.js";
import type { Server } from "../server.js";
import { passwordWorks, waysIn } from "./auth.js";
import type { Person } from "@frontier/schema";

const FIVE_MINUTES = 5 * 60 * 1000;

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");
const unb64 = (text: string) => new Uint8Array(Buffer.from(text, "base64url"));

const RegisterVerify = z.object({ name: z.string().trim().min(1).max(60), response: z.unknown() });
const LoginVerify = z.object({ response: z.object({ id: z.string() }).passthrough() });
const PasswordOff = z.object({ off: z.boolean() });

type Transport = "ble" | "cable" | "hybrid" | "internal" | "nfc" | "smart-card" | "usb";

/** Why the last way of logging in cannot go. */
const onlyWayIn = (person: Person) =>
  new ApiError(
    "not_allowed",
    person.passwordHash === ""
      ? "This is your only way to log in. Set a password first."
      : "This is your only passkey and the password is switched off. Switch the password on first.",
  );

export function passkeyRoutes(app: FastifyInstance, s: Server): void {
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
    // A passkey outlasts the session that adds it, so it is added only soon after a login.
    requireRecentLogin(request);
    const person = personOf(request);
    const options = await generateRegistrationOptions({
      rpName: "Frontier",
      rpID,
      userID: new TextEncoder().encode(person.id),
      userName: person.email || person.name || "frontier",
      userDisplayName: person.name || person.email || "Frontier",
      attestationType: "none",
      excludeCredentials: person.passkeys.map((p) => ({
        id: p.id,
        transports: p.transports as Transport[],
      })),
      authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
    });
    remember(request, options.challenge);
    return options;
  });

  app.post("/api/passkeys/register/verify", async (request) => {
    requireRecentLogin(request);
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
    // A credential id belongs to one account: it is not taken from another.
    const owner = await s.people.byPasskey(credential.id);
    if (owner && owner.id !== personOf(request).id) {
      throw new ApiError("invalid", "The passkey could not be checked. Try again.");
    }
    await s.people.update(personOf(request).id, (now) => ({
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

  app.post("/api/passkeys/login/options", { config: PUBLIC }, async (request) => {
    // Nobody has said who they are yet, so every passkey is offered to the device.
    const keys = (await s.people.all()).flatMap((p) => p.passkeys);
    if (keys.length === 0) {
      throw new ApiError("not_found", "No passkey is registered.");
    }
    const options = await generateAuthenticationOptions({
      rpID,
      userVerification: "required",
      allowCredentials: keys.map((p) => ({
        id: p.id,
        transports: p.transports as Transport[],
      })),
    });
    remember(request, options.challenge);
    return options;
  });

  app.post("/api/passkeys/login/verify", { config: PUBLIC }, async (request) => {
    s.loginLimit.attempt(request.ip);
    const { response } = LoginVerify.parse(request.body);
    const expectedChallenge = take(request);
    const person = await s.people.byPasskey(response.id);
    const passkey = person?.passkeys.find((p) => p.id === response.id);
    const refused = new ApiError("unauthenticated", "This passkey was not accepted.");
    if (!person || !passkey) throw refused;
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
    const now = await s.people.update(person.id, (p) => ({
      ...p,
      passkeys: p.passkeys.map((k) => (k.id === passkey.id ? { ...k, counter } : k)),
    }));
    startSession(request, now, "passkey");
    return { ok: true as const };
  });

  app.delete("/api/passkeys/:id", async (request) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    // The checks run on the account as it is when the change is made, not as it was when the
    // request arrived: two removals at once must not each see a passkey that is left.
    const now = await s.people.update(personOf(request).id, (person) => {
      if (!person.passkeys.some((p) => p.id === id)) {
        throw new ApiError("not_found", "There is no such passkey.");
      }
      // The last way of logging in stays.
      if (!passwordWorks(person) && waysIn(person) <= 1) throw onlyWayIn(person);
      return endOtherSessions({ ...person, passkeys: person.passkeys.filter((p) => p.id !== id) });
    });
    followEpoch(request, now);
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
    // Checked on the account as it is when the change is made; see the removal of a passkey.
    const now = await s.people.update(personOf(request).id, (person) => {
      if (off && person.passkeys.length === 0) {
        throw new ApiError(
          "not_allowed",
          "Add a passkey first: it would be your only way to log in.",
        );
      }
      if (!off && person.passwordHash === "") {
        throw new ApiError("not_allowed", "There is no password to switch on. Set one first.");
      }
      return endOtherSessions({ ...person, passwordOff: off });
    });
    followEpoch(request, now);
    return { ok: true as const };
  });
}
