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
import { monthsBefore } from "./keepGoing/history.js";

const DEFAULT_SAMPLE = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../packages/vault/test/fixture-vault",
);

/**
 * A few entries on top of the fixture vault, written over the last six months, so Home has
 * something of each kind to show: a stub that three entries link to (with a to-do mark and an
 * empty heading), links to entries not yet written, an orphan, a dead end and two entries that
 * name another without linking to it. They link only to each other, so the fixture's own entries
 * keep the links they have. The fixture itself is dated a year ago.
 */
interface SampleStep {
  /** How long before the sample is made the version is dated. */
  ago: { months: number } | { days: number };
  message: string;
  files: Record<string, string>;
}

const SAMPLE_STEPS: SampleStep[] = [
  {
    ago: { months: 6 },
    message: "Write the Salt Crystal",
    files: {
      "03 Things/Salt Crystal.md":
        "# Salt Crystal\n\nA clear crystal the brine leaves on the rim of a vat. It keeps no light and no heat.\n",
    },
  },
  {
    ago: { months: 1 },
    message: "Write Ruun",
    files: {
      "02 People/Ruun.md":
        "---\ntype: person\n---\n# Ruun\n\nRuun sings the tide in at [[Salt Flats]] and keeps the count of the barrels at " +
        "[[Brine Works]]. Her song is older than the road. The [[Tide Singers]] say it was never written down, and " +
        "that the [[The Sunken Gate]] opens only to it.\n",
    },
  },
  {
    ago: { days: 3 },
    message: "Write the Salt Road, the flats and the works",
    files: {
      "01 Places/Salt Flats.md":
        "# Salt Flats\n\nA white crust over the old sea floor. TODO: describe the crust and the light on it.\n\n" +
        "## Wildlife\n\n## Weather\n\nHot at noon, bitter cold by night.\n",
      "01 Places/Salt Road.md":
        "---\ntype: place\n---\n# Salt Road\n\nThe Salt Road runs from the [[Salt Flats]] to the sea, a day's walk for a loaded cart " +
        "and two for a tired one. Carters leave before dawn so that the heat does not spoil the load, and they " +
        "stop at [[Brine Works]] to weigh it. Past the works the road turns to packed shell and follows the shore, " +
        "and the first thing a traveller sees is the Harbor, grey under its own smoke. Few stay. The road is old " +
        "and the carters say it was laid before the town, by people who wanted salt more than they wanted company. " +
        "Where it crosses the dry river there are three stones, and each carter leaves a pinch of salt on the " +
        "middle one for luck. Beyond them, on clear mornings, the roof of the [[The Sunken Gate]] shows above " +
        "the flats like the back of a whale. Nobody has walked out to it and come back to say what it is, " +
        "though the [[Tide Singers]] sing of it when the tide is low.\n",
      "03 Things/Brine Works.md":
        "---\ntype: thing\n---\n# Brine Works\n\nThe vats where the flats' brine is boiled down. Mira counted the " +
        "barrels here once and found a sack of [[Salt Crystal]] that nobody had weighed. The works sell to the " +
        "[[Salt Flats]] carters and buy their silence in salt. The [[Tide Singers]] are paid in barrels, and from the " +
        "roof of the works the [[The Sunken Gate]] can be seen on clear days.\n",
    },
  },
  {
    ago: { days: 1 },
    message: "Brine Works: the boiling",
    files: {
      "03 Things/Brine Works.md":
        "---\ntype: thing\n---\n# Brine Works\n\nThe vats where the flats' brine is boiled down. Mira counted the " +
        "barrels here once and found a sack of [[Salt Crystal]] that nobody had weighed. The works sell to the " +
        "[[Salt Flats]] carters and buy their silence in salt. The [[Tide Singers]] are paid in barrels, and from the " +
        "roof of the works the [[The Sunken Gate]] can be seen on clear days.\n\n" +
        "The boiling takes three days, and the smell reaches the road.\n",
    },
  },
];

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
/**
 * The email given to commits when none is configured (a library of Frontier's own, and the
 * sample). It is not anyone's address, so the first account never takes it as theirs.
 */
export const PLACEHOLDER_AUTHOR_EMAIL = "author@frontier.invalid";

export function ensureSampleRemote(
  dataDir: string,
  sampleDir = DEFAULT_SAMPLE,
  /** The name of the repository made in `dataDir`; a project's own is `library.git`. */
  remoteName = "sample-remote.git",
): string {
  const remote = join(dataDir, remoteName);
  if (existsSync(remote)) return remote;
  mkdirSync(dataDir, { recursive: true });
  const work = mkdtempSync(join(tmpdir(), "frontier-sample-"));
  const run = (cwd: string, env: NodeJS.ProcessEnv, ...args: string[]) =>
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
      { cwd, stdio: "ignore", env: { ...process.env, ...env } },
    );
  const git = (cwd: string, ...args: string[]) => run(cwd, {}, ...args);
  // Versions are dated as if the library had been worked on for a year, so "this week", "on this
  // day" and "untouched for six months" have something to show.
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const dayAt = (day: string) => `${day}T12:00:00Z`;
  const commitOn = (cwd: string, day: string, message: string) => {
    git(cwd, "add", "-A");
    const at = dayAt(day);
    run(cwd, { GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at }, "commit", "-m", message);
  };
  const dayOf = (ago: SampleStep["ago"]) =>
    "months" in ago
      ? monthsBefore(today, ago.months)
      : new Date(now.getTime() - ago.days * 86_400_000).toISOString().slice(0, 10);
  try {
    cpSync(sampleDir, work, { recursive: true });
    // A made-up world to look at, and one map drawn over it.
    if (existsSync(SAMPLE_WORLD)) {
      cpSync(SAMPLE_WORLD, join(work, "99 Appendices", "Images", "Sample world.png"));
      mkdirSync(join(work, ".frontier", "maps"), { recursive: true });
      writeFileSync(join(work, ".frontier", "maps", "smplwrld.json"), SAMPLE_MAP);
    }
    git(work, "init", "--initial-branch=main");
    commitOn(work, monthsBefore(today, 12), "Sample vault");
    for (const step of SAMPLE_STEPS) {
      for (const [path, text] of Object.entries(step.files)) {
        mkdirSync(dirname(join(work, path)), { recursive: true });
        writeFileSync(join(work, path), text);
      }
      commitOn(work, dayOf(step.ago), step.message);
    }
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

/**
 * Makes Frontier's own library on first start: a repository on its own disk, with one note in it.
 * Returns its path, which the rest of the server uses as its remote.
 */
export function ensureOwnLibrary(dataDir: string): string {
  const library = join(dataDir, "library.git");
  if (existsSync(library)) return library;
  mkdirSync(dataDir, { recursive: true });
  const work = mkdtempSync(join(tmpdir(), "frontier-library-"));
  const git = (cwd: string, ...args: string[]) =>
    execFileSync(
      "git",
      ["-c", "user.name=Frontier", "-c", "user.email=frontier@frontier.invalid", ...args],
      { cwd, stdio: "ignore" },
    );
  try {
    git(work, "init", "--initial-branch=main");
    writeFileSync(
      join(work, "Welcome.md"),
      "# Welcome\n\nThis library is empty. Write a first entry, or bring your notes in from the Import page.\n",
    );
    git(work, "add", "-A");
    git(work, "commit", "-m", "Start the library");
    git(dataDir, "clone", "--bare", work, library);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  return library;
}

/**
 * Chooses how Frontier keeps its knowledge base, from the settings given. With no repository
 * named, it keeps a library of its own and needs no account anywhere.
 */
export function applyLibraryMode(env: NodeJS.ProcessEnv): void {
  if (env["FRONTIER_SAMPLE_VAULT"] === "1") {
    env["FRONTIER_LIBRARY"] = "sample";
    applySampleMode(env);
    return;
  }
  if (env["VAULT_REPO"]?.trim() || env["VAULT_REMOTE_URL"]?.trim()) return;
  const dataDir = env["DATA_DIR"]?.trim() || "/data";
  env["FRONTIER_LIBRARY"] = "own";
  env["VAULT_REMOTE_URL"] = ensureOwnLibrary(dataDir);
  env["COMMIT_AUTHOR_NAME"] ??= "Author";
  env["COMMIT_AUTHOR_EMAIL"] ??= PLACEHOLDER_AUTHOR_EMAIL;
  env["COMMIT_BOT_NAME"] ??= "frontier";
  env["COMMIT_BOT_EMAIL"] ??= "frontier@frontier.invalid";
  // Without a storage bucket the backup stays on the same disk, which the status page says.
  if (!env["BACKUP_S3_BUCKET"]?.trim()) env["BACKUP_LOCAL_DIR"] ??= join(dataDir, "backup");
}

/** Fills in the settings a sample run needs, so only a few variables have to be given. */
export function applySampleMode(env: NodeJS.ProcessEnv): void {
  if (env["FRONTIER_SAMPLE_VAULT"] !== "1") return;
  const dataDir = env["DATA_DIR"]?.trim() || "/data";
  env["VAULT_REMOTE_URL"] = ensureSampleRemote(dataDir);
  env["BACKUP_LOCAL_DIR"] ??= join(dataDir, "bucket");
  env["ICON_FOLDER"] ??= "99 Appendices/Icons";
  env["COMMIT_AUTHOR_NAME"] ??= "Sample Author";
  env["COMMIT_AUTHOR_EMAIL"] ??= PLACEHOLDER_AUTHOR_EMAIL;
  env["COMMIT_BOT_NAME"] ??= "frontier";
  env["COMMIT_BOT_EMAIL"] ??= "frontier@frontier.invalid";
}
