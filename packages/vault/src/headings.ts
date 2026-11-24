import { splitFrontmatter } from "./frontmatter.js";

export interface Heading {
  level: number;
  text: string;
  /** Line number in the whole file, starting at 1. */
  line: number;
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const ATX = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;

/** Extracts "#" headings, skipping frontmatter and fenced code blocks. */
export function extractHeadings(text: string): Heading[] {
  const { frontmatter, body } = splitFrontmatter(text);
  const offsetLines = frontmatter === null ? 0 : countLines(frontmatter);
  const out: Heading[] = [];
  let fence: string | null = null;
  const lines = body.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = (lines[i] ?? "").replace(/\r$/, "");
    const f = FENCE.exec(line);
    if (f) {
      const marker = f[1] ?? "";
      if (fence === null) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const m = ATX.exec(line);
    if (m)
      out.push({
        level: (m[1] ?? "").length,
        text: (m[2] ?? "").trim(),
        line: offsetLines + i + 1,
      });
  }
  return out;
}

function countLines(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 10) n++;
  return n;
}

/** The form in which two heading texts are compared: case and spacing do not matter. */
export function headingKey(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

export function findHeading(headings: Heading[], wanted: string): Heading | undefined {
  const key = headingKey(wanted);
  return headings.find((h) => headingKey(h.text) === key);
}
