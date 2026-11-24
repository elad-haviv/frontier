import type { FastifyInstance } from "fastify";
import { LoginRequest } from "@frontier/schema";
import { verifyPassword } from "../auth/password.js";
import { ApiError } from "../errors.js";
import type { Services } from "../app.js";

export function authRoutes(app: FastifyInstance, s: Services): void {
  // 5 attempts per 15 minutes per network address, counted together with passkey logins.
  app.post("/api/login", async (request) => {
    s.loginLimit.attempt(request.ip);
    const { password } = LoginRequest.parse(request.body);
    const settings = await s.settings.read();
    if (!settings) {
      throw new ApiError(
        "unauthenticated",
        "No password has been set yet. Run the set-password command on the server.",
      );
    }
    if (settings.passwordOff) {
      throw new ApiError(
        "unauthenticated",
        "Logging in with the password is switched off. Use a passkey.",
      );
    }
    if (settings.passwordHash === "" || !(await verifyPassword(settings.passwordHash, password))) {
      throw new ApiError("unauthenticated", "Wrong password.");
    }
    request.session.set("user", "author");
    request.session.set("method", "password");
    return { ok: true as const };
  });

  app.post("/api/logout", async (request) => {
    request.session.delete();
    return { ok: true as const };
  });

  app.get("/api/session", async (request) => {
    const settings = await s.settings.read();
    return {
      loggedIn: request.session.get("user") === "author",
      passkeys: (settings?.passkeys.length ?? 0) > 0,
      password: !settings?.passwordOff,
    };
  });
}
