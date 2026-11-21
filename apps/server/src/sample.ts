/**
 * Sample mode: runs Frontier on a made-up vault instead of a real one, for previews.
 *
 * With FRONTIER_SAMPLE_VAULT=1 the server makes a local Git repository from the bundled sample
 * vault and uses it as its remote. Nothing outside the container is read or written.
 */
import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_SAMPLE = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../packages/vault/test/fixture-vault",
);

const SAMPLE_WORLD = join(
  dirname(fileURLToPath(import.meta.url)),
  "../sample-assets/sample-world.png",
);

const SAMPLE_MAP = `{
  "version": 1,
  "id": "smplwrld",
  "title": "Sample world",
  "space": {"kind":"sphere","radius":null,"unit":"km"},
  "images": [
    {"id":"smplimg1","name":"Sample world","path":"99 Appendices/Images/Sample world.png","extent":[-180,-90,180,90],"visible":true}
  ],
  "markerSets": ["Icons"],
  "layers": [
    {"id":"smpllyr1","name":"Places","visible":true,"color":"#9a3b1f"},
    {"id":"smpllyr2","name":"Routes and realms","visible":true,"color":"#2f5d8a"}
  ],
  "features": [
    {"id":"smplft01","kind":"marker","layer":"smpllyr1","at":[-106,23],"entry":null,"label":"Harbor","icon":{"set":"Icons","name":"Lamp"},"child":null},
    {"id":"smplft02","kind":"marker","layer":"smpllyr1","at":[40,32],"entry":null,"label":"The Green Heart","icon":null,"child":null},
    {"id":"smplft03","kind":"marker","layer":"smpllyr1","at":[98,-19],"entry":null,"label":"Far Landing","icon":null,"child":null},
    {"id":"smplft04","kind":"path","layer":"smpllyr2","points":[[-106,23],[-48,-8],[40,32],[98,-19]],"entry":null,"label":"The Long Crossing","child":null},
    {"id":"smplft05","kind":"zone","layer":"smpllyr2","points":[[-140,38],[-80,48],[-70,15],[-110,-5],[-150,18]],"entry":null,"label":"The Western Realm","child":null}
  ]
}
`;

/** The proposal branch the sample remote starts with. */
export const SAMPLE_BRANCH = "proposal/sample-agent/harbor-keeper";

/** Creates the sample remote if needed and returns its path. */
export function ensureSampleRemote(dataDir: string, sampleDir = DEFAULT_SAMPLE): string {
  const remote = join(dataDir, "sample-remote.git");
  if (existsSync(remote)) return remote;
  mkdirSync(dataDir, { recursive: true });
  const work = mkdtempSync(join(tmpdir(), "frontier-sample-"));
  const git = (cwd: string, ...args: string[]) =>
    execFileSync(
      "git",
      [
        "-c",
        "user.name=Frontier Sample",
        "-c",
        "user.email=sample@frontier.invalid",
        "-c",
        "core.autocrlf=false",
        ...args,
      ],
      { cwd, stdio: "ignore" },
    );
  try {
    cpSync(sampleDir, work, { recursive: true });
    // A made-up world to look at, and one map drawn over it.
    if (existsSync(SAMPLE_WORLD)) {
      cpSync(SAMPLE_WORLD, join(work, "99 Appendices", "Images", "Sample world.png"));
      mkdirSync(join(work, ".frontier", "maps"), { recursive: true });
      writeFileSync(join(work, ".frontier", "maps", "smplwrld.json"), SAMPLE_MAP);
    }
    git(work, "init", "--initial-branch=main");
    git(work, "add", "-A");
    git(work, "commit", "-m", "Sample vault");
    // One proposal from a made-up agent, so the inbox has something to show.
    git(work, "checkout", "-b", SAMPLE_BRANCH);
    writeFileSync(
      join(work, "02 People", "Harbor Keeper.md"),
      "# Harbor Keeper\n\nKeeps the lamp at the [[Old Quay]] and knows [[Mira]] by her step.\n",
    );
    appendFileSync(
      join(work, "03 Things", "Ledger.md"),
      "\nThe [[Harbor Keeper]] owns one like it.\n",
    );
    git(work, "add", "-A");
    git(work, "commit", "-m", "Propose the Harbor Keeper");
    git(work, "checkout", "main");
    git(dataDir, "clone", "--bare", work, remote);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  return remote;
}

/** Fills in the settings a sample run needs, so only a few variables have to be given. */
export function applySampleMode(env: NodeJS.ProcessEnv): void {
  if (env["FRONTIER_SAMPLE_VAULT"] !== "1") return;
  const dataDir = env["DATA_DIR"]?.trim() || "/data";
  env["VAULT_REMOTE_URL"] = ensureSampleRemote(dataDir);
  env["BACKUP_LOCAL_DIR"] ??= join(dataDir, "bucket");
  env["ICON_FOLDER"] ??= "99 Appendices/Icons";
  env["COMMIT_AUTHOR_NAME"] ??= "Sample Author";
  env["COMMIT_AUTHOR_EMAIL"] ??= "author@frontier.invalid";
  env["COMMIT_BOT_NAME"] ??= "frontier";
  env["COMMIT_BOT_EMAIL"] ??= "frontier@frontier.invalid";
}
