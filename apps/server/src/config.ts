/**
 * Reads and checks the environment variables. A missing or malformed variable stops the server at
 * start with a message that names it.
 */

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
  /** Present when the remote is GitHub; absent with VAULT_REMOTE_URL. */
  githubApp: GithubAppConfig | null;
  webhookSecret: string | null;
  sessionKey: Buffer;
  commitAuthor: { name: string; email: string };
  commitBot: { name: string; email: string };
  backup: { kind: "local"; dir: string } | { kind: "s3"; s3: S3Config };
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
  let webhookSecret: string | null = optional("WEBHOOK_SECRET");
  if (override) {
    remoteUrl = override;
  } else {
    const repo = get("VAULT_REPO");
    remoteUrl = `https://github.com/${repo}.git`;
    githubApp = {
      appId: get("GITHUB_APP_ID"),
      privateKey: get("GITHUB_APP_PRIVATE_KEY").replace(/\\n/g, "\n"),
      installationId: get("GITHUB_APP_INSTALLATION_ID"),
    };
    webhookSecret = get("WEBHOOK_SECRET");
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

  return {
    publicUrl,
    dataDir,
    remoteUrl,
    githubApp,
    webhookSecret,
    sessionKey,
    commitAuthor,
    commitBot,
    backup,
  };
}
