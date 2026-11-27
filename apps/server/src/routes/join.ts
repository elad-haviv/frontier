/**
 * Joining a project through an invitation link (stage 27c). The code in the address is the only
 * thing that says which project and which role: no body field can choose either, or "admin".
 * Someone new makes an account with an email and a password, or a passkey on this device, or
 * Google (`routes/google.ts`); someone who has an account logs in and accepts. Every public route
 * counts against the same per-address allowance, and an unknown code is answered exactly as a
 * malformed one.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { generateRegistrationOptions, verifyRegistrationResponse } from "@simplewebauthn/server";
import { randomBytes } from "node:crypto";
import {
  JoinPasskeyOptionsRequest,
  JoinPasswordRequest,
  type JoinedResponse,
  type JoinInfo,
} from "@frontier/schema";
import { z } from "zod";
import { PUBLIC } from "../auth/openness.js";
import { hashPassword } from "../auth/password.js";
import { currentPerson, personOf, startSession } from "../auth/session.js";
import { ApiError } from "../errors.js";
import {
  accountExists,
  joinAsExistingPerson,
  joinAsNewPerson,
  liveInvite,
  type Joined,
} from "../members/join.js";
import { displayName } from "../members/names.js";
import type { Server } from "../server.js";

const CodeParam = z.object({ code: z.string().max(200) });
const FIVE_MINUTES = 5 * 60 * 1000;
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");
const PasskeyVerify = z.object({
  response: z.unknown(),
  /** What the passkey is called in Settings. */
  passkeyName: z.string().trim().min(1).max(60).default("Passkey on this device"),
});

type Transport = "ble" | "cable" | "hybrid" | "internal" | "nfc" | "smart-card" | "usb";

export function joinRoutes(app: FastifyInstance, s: Server): void {
  const origin = new URL(s.config.publicUrl).origin;
  const rpID = new URL(s.config.publicUrl).hostname;
  const codeOf = (request: FastifyRequest) => CodeParam.parse(request.params).code;
  const answer = (joined: Joined): JoinedResponse => ({
    ok: true,
    project: joined.project.slug,
    role: joined.role,
  });

  app.get("/api/join/:code", { config: PUBLIC }, async (request, reply): Promise<JoinInfo> => {
    s.joinLimit.attempt(request.ip);
    reply.header("cache-control", "no-store");
    const { invite, project } = await liveInvite(s, codeOf(request));
    let entries: number | null = null;
    let maps: number | null = null;
    try {
      const open = await s.registry.open(project);
      entries = open.index.allNotes().length;
      maps = (await open.maps.list()).length;
    } catch (err) {
      request.log.error(
        { err, project: project.slug },
        "Could not open a project for its invitation",
      );
    }
    const person = await currentPerson(request, s.people);
    return {
      project: {
        name: project.name,
        colour: project.colour,
        entries,
        maps,
        people: project.members.length,
      },
      inviter: { name: displayName(await s.people.get(invite.createdBy)) },
      role: invite.role,
      google: s.google !== null,
      alreadyMember: person !== null && project.members.some((m) => m.personId === person.id),
    };
  });

  /** Someone new, with an email and a password. */
  app.post("/api/join/:code", { config: PUBLIC }, async (request): Promise<JoinedResponse> => {
    s.joinLimit.attempt(request.ip);
    const code = codeOf(request);
    const { name, email, password } = JoinPasswordRequest.parse(request.body);
    // The link is looked at first, so a dead one is told so before anything about the email.
    await liveInvite(s, code);
    if (await s.people.byEmail(email)) throw accountExists();
    const passwordHash = await hashPassword(password);
    const joined = await joinAsNewPerson(s, code, { name, email, passwordHash });
    startSession(request, joined.person, "password");
    return answer(joined);
  });

  /** Step one of a passkey join: the options for the browser, bound to this invitation. */
  app.post("/api/join/:code/passkey/options", { config: PUBLIC }, async (request) => {
    s.joinLimit.attempt(request.ip);
    const { invite } = await liveInvite(s, codeOf(request));
    const { name, email } = JoinPasskeyOptionsRequest.parse(request.body);
    if (await s.people.byEmail(email)) throw accountExists();
    const options = await generateRegistrationOptions({
      rpName: "Frontier",
      rpID,
      userID: randomBytes(16),
      userName: email,
      userDisplayName: name,
      attestationType: "none",
      authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
    });
    request.session.set("joinChallenge", {
      value: options.challenge,
      until: Date.now() + FIVE_MINUTES,
      invite: invite.id,
      name,
      email,
    });
    return options;
  });

  /** Step two: the passkey is checked, and the account, the membership and the use of the link follow. */
  app.post(
    "/api/join/:code/passkey/verify",
    { config: PUBLIC },
    async (request): Promise<JoinedResponse> => {
      s.joinLimit.attempt(request.ip);
      const code = codeOf(request);
      const { response, passkeyName } = PasskeyVerify.parse(request.body);
      const stored = request.session.get("joinChallenge");
      // A challenge can be used once.
      request.session.set("joinChallenge", undefined);
      const { invite } = await liveInvite(s, code);
      if (!stored || stored.until < Date.now() || stored.invite !== invite.id) {
        throw new ApiError("invalid", "This took too long. Start again.");
      }
      let result;
      try {
        result = await verifyRegistrationResponse({
          response: response as Parameters<typeof verifyRegistrationResponse>[0]["response"],
          expectedChallenge: stored.value,
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
      // A credential id belongs to one account.
      if (await s.people.byPasskey(credential.id)) {
        throw new ApiError("invalid", "The passkey could not be checked. Try again.");
      }
      const joined = await joinAsNewPerson(s, code, {
        name: stored.name,
        email: stored.email,
        passkeys: [
          {
            id: credential.id,
            publicKey: b64(credential.publicKey),
            counter: credential.counter,
            transports: (credential.transports ?? []) as Transport[],
            name: passkeyName,
            addedAt: new Date().toISOString(),
          },
        ],
      });
      startSession(request, joined.person, "passkey");
      return answer(joined);
    },
  );

  /**
   * Someone who has an account, logged in, accepts. Already in the project: told so, and the link
   * is left unused for the owner to give to someone else.
   */
  app.post("/api/join/:code/accept", async (request): Promise<JoinedResponse> => {
    s.joinLimit.attempt(request.ip);
    const joined = await joinAsExistingPerson(s, codeOf(request), personOf(request));
    return answer(joined);
  });
}
