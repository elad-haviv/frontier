/**
 * Reads and checks the environment variables. A missing or malformed variable stops the server at
 * start with a message that names it.
 */

import type { AiProviderKind } from "@frontier/schema";

/** Google's OpenID Connect issuer, whose discovery document names the rest. */
export const GOOGLE_ISSUER = "https://accounts.google.com";
const DEFAULT_OPENROUTER_URL = "https://openrouter.ai/api/v1";

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export interface GithubAppConfig {
  appId: string;
  privateKey: string;
  installationId: string;
}

export interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  pathStyle: boolean;
}

export interface Config {
  publicUrl: string;
  dataDir: string;
  /** The Git address the working copy is cloned from and pushed to. */
  remoteUrl: string;
  /** Present when Frontier pushes as its own GitHub App. */
  githubApp: GithubAppConfig | null;
  /** Present when Frontier pushes with a personal access token instead of an App. */
  githubToken: string | null;
  webhookSecret: string | null;
  sessionKey: Buffer;
  commitAuthor: { name: string; email: string };
  commitBot: { name: string; email: string };
  backup: { kind: "local"; dir: string } | { kind: "s3"; s3: S3Config };
  /**
   * Where the knowledge base lives: in a repository of Frontier's own, in one on GitHub that
   * others write to as well, or in the made-up sample.
   */
  library: "own" | "github" | "sample";
  /** What the first project is called, made from the library the server already had (stage 27b). */
  projectName: string;
  /** The vault folder new images are put in. */
  uploadFolder: string;
  /** The vault folder whose subfolders are marker sets. */
  iconFolder: string;
  /** OpenRouter's address, which the model list also reads its public prices from. */
  openrouterUrl: string;
  /**
   * The addresses the environment gives for the providers (OPENROUTER_BASE_URL and the others'
   * *_BASE_URL); tests point them at stand-in servers. AI keys are not read from the environment:
   * each person's key stays in their own browser (stage 27f).
   */
  providerUrls: Partial<Record<AiProviderKind, string>>;
  /**
   * The names of provider key variables (OPENROUTER_API_KEY and the others) that are set in the
   * environment although they are no longer read. The owner is told once, to remove them.
   */
  unusedKeyVars: string[];
  /**
   * Lets an image be taken from a web address on this machine's loopback addresses, on any port,
   * so the tests can serve one. Off by default, and refused in production.
   */
  imageFetchAllowLoopback: boolean;
  /**
   * How many login attempts one address may make in 15 minutes: 5. Only the browser tests, which
   * log in and change passwords many times from one address, raise it (`LOGIN_ATTEMPTS`); it is
   * refused in production.
   */
  loginAttempts: number;
  /**
   * Google sign-on (stage 27c): present when `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are
   * both given; absent turns the feature off. `issuer` is Google's own except in tests, which
   * point it at a stand-in provider (`GOOGLE_ISSUER`; refused in production).
   */
  google: { clientId: string; clientSecret: string; issuer: string } | null;
  /**
   * False when `FRONTIER_SERVICE_WORKER=off`: `/sw.js` then answers the kill worker, which removes
   * the app's service worker from every browser that has it.
   */
  serviceWorker: boolean;
}

type Env = Record<string, string | undefined>;

export function loadConfig(env: Env = process.env): Config {
  const missing: string[] = [];
  const get = (name: string): string => {
    const v = env[name]?.trim();
    if (!v) {
      missing.push(name);
      return "";
    }
    return v;
  };
  const optional = (name: string): string | null => env[name]?.trim() || null;

  const publicUrl = get("PUBLIC_URL");
  const dataDir = optional("DATA_DIR") ?? "/data";

  const override = optional("VAULT_REMOTE_URL");
  let remoteUrl: string;
  let githubApp: GithubAppConfig | null = null;
  let githubToken: string | null = null;
  const webhookSecret: string | null = optional("WEBHOOK_SECRET");
  if (override) {
    remoteUrl = override;
  } else {
    const repo = get("VAULT_REPO");
    remoteUrl = `https://github.com/${repo}.git`;
    // A fine-grained personal access token is the simple way in; a GitHub App gives Frontier an
    // identity of its own. One of the two is needed. The webhook is optional: without it the vault
    // is fetched on a timer.
    githubToken = optional("GITHUB_TOKEN");
    if (!githubToken) {
      githubApp = {
        appId: get("GITHUB_APP_ID"),
        privateKey: get("GITHUB_APP_PRIVATE_KEY").replace(/\\n/g, "\n"),
        installationId: get("GITHUB_APP_INSTALLATION_ID"),
      };
    }
  }

  const sessionKeyText = get("SESSION_KEY");
  const sessionKey = Buffer.from(sessionKeyText, "base64");

  const commitAuthor = { name: get("COMMIT_AUTHOR_NAME"), email: get("COMMIT_AUTHOR_EMAIL") };
  const commitBot = { name: get("COMMIT_BOT_NAME"), email: get("COMMIT_BOT_EMAIL") };

  const localBackup = optional("BACKUP_LOCAL_DIR");
  const backup: Config["backup"] = localBackup
    ? { kind: "local", dir: localBackup }
    : {
        kind: "s3",
        s3: {
          endpoint: get("BACKUP_S3_ENDPOINT"),
          region: get("BACKUP_S3_REGION"),
          bucket: get("BACKUP_S3_BUCKET"),
          accessKey: get("BACKUP_S3_ACCESS_KEY"),
          secretKey: get("BACKUP_S3_SECRET_KEY"),
          pathStyle: (optional("BACKUP_S3_PATH_STYLE") ?? "true") !== "false",
        },
      };

  if (missing.length > 0) {
    throw new ConfigError(
      `Missing environment variable${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}`,
    );
  }
  const imageFetchAllowLoopback = ["1", "true"].includes(
    optional("IMAGE_FETCH_ALLOW_LOOPBACK")?.toLowerCase() ?? "",
  );
  if (imageFetchAllowLoopback && optional("NODE_ENV") === "production") {
    throw new ConfigError(
      "IMAGE_FETCH_ALLOW_LOOPBACK is for tests and cannot be set in production.",
    );
  }
  const loginAttempts = Number(optional("LOGIN_ATTEMPTS") ?? 5);
  if (!Number.isInteger(loginAttempts) || loginAttempts < 1) {
    throw new ConfigError("LOGIN_ATTEMPTS must be a whole number of at least 1.");
  }
  if (loginAttempts !== 5 && optional("NODE_ENV") === "production") {
    throw new ConfigError("LOGIN_ATTEMPTS is for tests and cannot be set in production.");
  }
  if (sessionKey.length !== 32) {
    throw new ConfigError(
      "SESSION_KEY must be 32 bytes in base64. Generate one with: openssl rand -base64 32",
    );
  }
  try {
    new URL(publicUrl);
  } catch {
    throw new ConfigError(
      "PUBLIC_URL must be a full address, such as https://frontier.example.com",
    );
  }

  const googleId = optional("GOOGLE_CLIENT_ID");
  const googleSecret = optional("GOOGLE_CLIENT_SECRET");
  if ((googleId === null) !== (googleSecret === null)) {
    throw new ConfigError("Google sign-on needs both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.");
  }
  const googleIssuer = optional("GOOGLE_ISSUER")?.replace(/\/+$/, "") ?? GOOGLE_ISSUER;
  if (googleIssuer !== GOOGLE_ISSUER && optional("NODE_ENV") === "production") {
    throw new ConfigError("GOOGLE_ISSUER is for tests and cannot be set in production.");
  }

  const urlOf = (name: string) => optional(name)?.replace(/\/+$/, "") ?? null;
  const openrouterUrl = urlOf("OPENROUTER_BASE_URL") ?? DEFAULT_OPENROUTER_URL;
  const providerUrls: Config["providerUrls"] = { openrouter: openrouterUrl };
  for (const [kind, name] of [
    ["anthropic", "ANTHROPIC_BASE_URL"],
    ["openai", "OPENAI_BASE_URL"],
    ["google", "GEMINI_BASE_URL"],
    ["xai", "XAI_BASE_URL"],
  ] as const) {
    const url = urlOf(name);
    if (url) providerUrls[kind] = url;
  }

  const unusedKeyVars = [
    "OPENROUTER_API_KEY",
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "GEMINI_API_KEY",
    "XAI_API_KEY",
  ].filter((name) => optional(name) !== null);

  return {
    publicUrl,
    dataDir,
    remoteUrl,
    githubApp,
    githubToken,
    uploadFolder: (optional("UPLOAD_FOLDER") ?? "99 Appendices/01 Images").replace(
      /^\/+|\/+$/g,
      "",
    ),
    webhookSecret,
    sessionKey,
    loginAttempts,
    unusedKeyVars,
    library:
      optional("FRONTIER_LIBRARY") === "sample"
        ? "sample"
        : optional("FRONTIER_LIBRARY") === "own" || !optional("VAULT_REPO")
          ? "own"
          : "github",
    projectName:
      optional("FRONTIER_PROJECT_NAME")?.slice(0, 80) ??
      (optional("FRONTIER_LIBRARY") === "sample" || optional("FRONTIER_SAMPLE_VAULT") === "1"
        ? "Sample"
        : "Avalymia"),
    iconFolder: (optional("ICON_FOLDER") ?? "99 Appendices/07 Icons").replace(/^\/+|\/+$/g, ""),
    openrouterUrl,
    providerUrls,
    imageFetchAllowLoopback,
    google:
      googleId !== null && googleSecret !== null
        ? { clientId: googleId, clientSecret: googleSecret, issuer: googleIssuer }
        : null,
    serviceWorker: optional("FRONTIER_SERVICE_WORKER")?.toLowerCase() !== "off",
    commitAuthor,
    commitBot,
    backup,
  };
}
