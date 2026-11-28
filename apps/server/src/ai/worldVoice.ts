/**
 * Whose world the AI is writing about (stage 34). The instructions of every AI feature name the
 * world and its rules through two marks, filled in for the project the request is in, so a
 * project made yesterday is not told it is Avalymia.
 *
 * A project says what its world is in its World brief: an entry whose `type` is `world-brief`.
 * Its `world` field is the world's name, and each bullet under its "Rules" heading is a rule the
 * AI is told whenever it writes for the project. The World Wizard writes one; the author can write
 * or change one by hand. Only the saved brief is read, and never one waiting in quarantine.
 * Without a brief the world goes by the project's name and has no rules, except the library this
 * app was built for, Avalymia, which keeps the one rule it has always been given.
 */
import type { IndexedNote } from "../index/build.js";
import type { AiProvider } from "./provider.js";

export interface WorldVoice {
  name: string;
  rules: string[];
}

/** In instructions: the name of the world. */
export const WORLD = "{{WORLD}}";
/** In instructions, a line by itself: the world's rules, one to a line; no line when there are none. */
export const WORLD_RULES = "{{WORLD_RULES}}";
/** The `type` of the entry that is a project's World brief. */
export const BRIEF_TYPE = "world-brief";

export const VOICE_LIMITS = { name: 100, rules: 12, ruleChars: 300 };

const AVALYMIA = "Avalymia";
const AVALYMIA_RULE =
  "the Nirani have no visual culture, no visual language and no light traditions; their timekeeping is not visual.";

/** One line of plain words: nothing that could be read as a mark or start a new instruction. */
const plain = (text: string, max: number): string =>
  text.replace(/[{}]/g, "").replace(/\s+/g, " ").trim().slice(0, max);

/** The instructions with the world's name and rules in place of the marks. */
export function fill(system: string, world: WorldVoice): string {
  const rules = world.rules.map((r) => `- The world's rules matter: ${r}`);
  return system
    .split("\n")
    .flatMap((line) => (line.trim() === WORLD_RULES ? rules : [line]))
    .join("\n")
    .replaceAll(WORLD, world.name);
}

/** What a World brief says: the world's name, if it gives one, and its rules. */
export function readBrief(text: string): { name: string | null; rules: string[] } {
  const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? "";
  const named = /^world:\s*(.+)$/m.exec(front)?.[1] ?? "";
  const name = plain(named.replace(/^["']|["']$/g, ""), VOICE_LIMITS.name);
  const rules: string[] = [];
  let inRules = false;
  for (const line of text.split(/\r?\n/)) {
    const heading = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      inRules = /^rules$/i.test(heading[1]!.trim());
      continue;
    }
    const bullet = inRules ? /^\s*[-*]\s+(.+)$/.exec(line) : null;
    if (!bullet) continue;
    const rule = plain(
      bullet[1]!.replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, "$2"),
      VOICE_LIMITS.ruleChars,
    );
    if (rule !== "" && rules.length < VOICE_LIMITS.rules) rules.push(rule);
  }
  return { name: name === "" ? null : name, rules };
}

/** The world of a project: from its World brief, else by the project's name. */
export function worldVoice(
  notes: readonly IndexedNote[],
  mayRead: (path: string) => boolean,
  projectName: string,
): WorldVoice {
  const fallback = plain(projectName, VOICE_LIMITS.name) || "the author's world";
  // The first by path, so which brief is read does not change from one request to the next.
  const brief = notes
    .filter((n) => n.fields.type?.trim().toLowerCase() === BRIEF_TYPE && mayRead(n.path))
    .sort((a, b) => a.path.localeCompare(b.path))[0];
  if (brief) {
    const read = readBrief(brief.text);
    return { name: read.name ?? fallback, rules: read.rules };
  }
  return { name: fallback, rules: fallback === AVALYMIA ? [AVALYMIA_RULE] : [] };
}

/**
 * The provider as a project uses it: every call's instructions are filled in for that project's
 * world. Everything else (the cap, the log, the models) is the shared provider's own.
 */
export function forWorld(provider: AiProvider, voice: () => WorldVoice): AiProvider {
  const complete = ((input: Parameters<AiProvider["complete"]>[0]) =>
    provider.complete({
      ...input,
      system: fill(input.system, voice()),
    })) as AiProvider["complete"];
  // Everything but `complete` is the shared provider itself: what is set through a project's
  // view of it (where failures are logged, the catalogue) is set on the one provider.
  return new Proxy(provider, {
    get(target, prop) {
      if (prop === "complete") return complete;
      const value: unknown = Reflect.get(target, prop, target);
      return typeof value === "function"
        ? (value as (...args: unknown[]) => unknown).bind(target)
        : value;
    },
    set: (target, prop, value) => Reflect.set(target, prop, value, target),
  });
}
