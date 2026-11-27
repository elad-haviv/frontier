import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import { isoBase64URL, isoCBOR } from "@simplewebauthn/server/helpers";

/**
 * A software authenticator that answers a registration (`navigator.credentials.create`) the way a
 * phone's would, with attestation "none", so the server's own verification runs for real.
 */
export function registerPasskey(
  options: { challenge: string; rp: { id?: string } },
  origin: string,
  flags = 0x45,
): { response: unknown; id: string } {
  const { publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" });
  const cose = new Map<number, number | Uint8Array>([
    [1, 2],
    [3, -7],
    [-1, 1],
    [-2, new Uint8Array(Buffer.from(jwk.x!, "base64url"))],
    [-3, new Uint8Array(Buffer.from(jwk.y!, "base64url"))],
  ]);
  const credentialId = randomBytes(16);
  const idLength = Buffer.alloc(2);
  idLength.writeUInt16BE(credentialId.length);
  const authData = Buffer.concat([
    createHash("sha256")
      .update(options.rp.id ?? "")
      .digest(),
    Buffer.from([flags]),
    Buffer.alloc(4),
    Buffer.alloc(16),
    idLength,
    credentialId,
    Buffer.from(isoCBOR.encode(cose)),
  ]);
  const attestationObject = isoCBOR.encode(
    new Map<string | number, Uint8Array | string | Map<string | number, never>>([
      ["fmt", "none"],
      ["attStmt", new Map<string | number, never>()],
      ["authData", new Uint8Array(authData)],
    ]),
  );
  const clientData = JSON.stringify({
    type: "webauthn.create",
    challenge: options.challenge,
    origin,
    crossOrigin: false,
  });
  const id = isoBase64URL.fromBuffer(new Uint8Array(credentialId));
  return {
    id,
    response: {
      id,
      rawId: id,
      type: "public-key",
      clientExtensionResults: {},
      response: {
        clientDataJSON: Buffer.from(clientData).toString("base64url"),
        attestationObject: isoBase64URL.fromBuffer(attestationObject),
        transports: ["internal"],
      },
    },
  };
}
