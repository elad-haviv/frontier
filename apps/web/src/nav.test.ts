import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/** Every non-test source file of the app, with its text. */
function sources(dir = join(import.meta.dirname)): { file: string; text: string }[] {
  const out: { file: string; text: string }[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sources(path));
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push({ file: relative(import.meta.dirname, path), text: readFileSync(path, "utf8") });
    }
  }
  return out;
}

const ALL = sources();

describe("addresses go through one place", () => {
  it("no page reaches for the router's own links and navigation, which know no project", () => {
    // Only the files that stand outside any project (the router's root, the project's own route
    // and the wrappers themselves) may use the router's address-bearing parts.
    const allowed = new Set(["nav.tsx", "main.tsx", "App.tsx", "components/ProjectScope.tsx"]);
    const own = /\b(Link|NavLink|Navigate|useNavigate|useLocation)\b/;
    const offenders = ALL.filter(({ file, text }) => {
      if (allowed.has(file)) return false;
      return [
        ...text.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+"react-router-dom"/g),
      ].some((m) => own.test(m[1]!));
    }).map((o) => o.file);
    expect(offenders).toEqual([]);
  });

  it("no source writes an app address by hand into an href, or sends the browser to one", () => {
    const hand = [
      /href=["'`]\/(?!api\/|\/)/, // href="/maps"
      /location\.(assign|replace)\(["'`]\/(?!login)/,
      /window\.open\(["'`]\/(?!api)/,
      /\.href\s*=\s*["'`]\/(?!login)/,
    ];
    const offenders = ALL.flatMap(({ file, text }) =>
      hand.filter((re) => re.test(text)).map((re) => `${file}: ${re}`),
    );
    expect(offenders).toEqual([]);
  });

  it("no source builds the address of an entry, an editor or a project page by hand", () => {
    // `entryUrl`, `editUrl` and the rest in `api.ts` write them project-relative; nothing else
    // concatenates `/e/` or `/edit/` onto a path.
    const offenders = ALL.filter(({ file, text }) => {
      if (file === "api.ts" || file === "project.ts" || file === "nav.tsx") return false;
      return /["'`]\/(e|edit)\/["'`]?\s*\+|`\/(e|edit)\/\$\{/.test(text);
    }).map((o) => o.file);
    expect(offenders).toEqual([]);
  });
});
