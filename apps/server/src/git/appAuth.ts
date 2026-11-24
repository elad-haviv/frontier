import { createAppAuth } from "@octokit/auth-app";
import type { GithubAppConfig } from "../config.js";

/**
 * Returns a function that supplies an installation token for Frontier's GitHub App.
 * The library caches the token and renews it before it expires.
 */
export function appTokenSource(app: GithubAppConfig): () => Promise<string> {
  const auth = createAppAuth({
    appId: app.appId,
    privateKey: app.privateKey,
    installationId: Number(app.installationId),
  });
  return async () => (await auth({ type: "installation" })).token;
}
