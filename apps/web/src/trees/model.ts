/**
 * The tree, worked out on the device from `/api/relations` and one saved tree (stage 30): who is
 * above and below whom, the layout of a family (couples side by side, children hanging from the
 * couple they belong to), how two people are related, and the checks. Nothing here draws.
 */
import {
  findKind,
  type RelationsResponse,
  type RelFact,
  type RelKind,
  type RelPerson,
  type TreeLine,
} from "@frontier/schema";

/** One edge from above to below (or between equals), a written fact or one implied by `with`. */
export interface Edge {
  kind: string;
  a: string;
  b: string;
  how: string | null;
  when: string | null;
  fact: RelFact;
  /** Set for a relation the AI proposed (stage 33): its place in `proposed`. */
  proposed?: number;
}

export interface Graph {
  people: Map<string, RelPerson>;
  kinds: RelKind[];
  facts: RelFact[];
  edges: Edge[];
  /** By kind, then by the lower one: the edges to those above. */
  upMap: Map<string, Map<string, Edge[]>>;
  /** By kind, then by the upper one: the edges to those below. */
  downMap: Map<string, Map<string, Edge[]>>;
  /** By kind, then by person: the edges to equals. */
  symMap: Map<string, Map<string, Edge[]>>;
}

const push = <K, V>(m: Map<K, V[]>, k: K, v: V) => {
  const list = m.get(k);
  if (list) list.push(v);
  else m.set(k, [v]);
};
const inner = (m: Map<string, Map<string, Edge[]>>, k: string) => {
  let x = m.get(k);
  if (!x) m.set(k, (x = new Map()));
  return x;
};

/**
 * The relations as a graph. With `proposed`, the AI's proposals are in it too, marked, for
 * drawing; checks and kinship are worked out on a graph without them.
 */
export function makeGraph(r: RelationsResponse, opts: { proposed?: boolean } = {}): Graph {
  const people = new Map(r.people.map((p) => [p.key, p]));
  const edges: Edge[] = [];
  const upMap = new Map<string, Map<string, Edge[]>>();
  const downMap = new Map<string, Map<string, Edge[]>>();
  const symMap = new Map<string, Map<string, Edge[]>>();
  const seen = new Set<string>();
  const add = (e: Edge) => {
    const id = `${e.kind}|${e.a}|${e.b}`;
    if (seen.has(id)) return;
    seen.add(id);
    edges.push(e);
    const kind = r.kinds.find((k) => k.name === e.kind);
    if (kind?.reverse) {
      push(inner(upMap, e.kind), e.b, e);
      push(inner(downMap, e.kind), e.a, e);
    } else {
      push(inner(symMap, e.kind), e.a, e);
      push(inner(symMap, e.kind), e.b, e);
    }
  };
  for (const f of r.facts) add({ kind: f.kind, a: f.a, b: f.b, how: f.how, when: f.when, fact: f });
  // "child: Nessa, with: Garrow" on Wren also says Garrow is Nessa's parent.
  for (const f of r.facts) {
    if (f.with) add({ kind: f.kind, a: f.with, b: f.b, how: f.how, when: f.when, fact: f });
  }
  if (opts.proposed) {
    (r.proposed ?? []).forEach((p, i) => {
      const fact: RelFact = {
        kind: p.kind,
        a: p.a,
        b: p.b,
        with: p.with,
        how: p.how,
        when: p.when,
        sources: [{ path: p.path, index: 0, word: p.word }],
        disagree: null,
      };
      add({ kind: p.kind, a: p.a, b: p.b, how: p.how, when: p.when, fact, proposed: i });
      if (p.with && p.with !== p.a)
        add({ kind: p.kind, a: p.with, b: p.b, how: p.how, when: p.when, fact, proposed: i });
    });
  }
  return { people, kinds: r.kinds, facts: r.facts, edges, upMap, downMap, symMap };
}

export const kindNamed = (g: Graph, name: string): RelKind | undefined =>
  g.kinds.find((k) => k.name === name) ?? findKind(g.kinds, name)?.kind;
/** The kind drawn as couples in a family: "partner". */
export const coupleKind = (g: Graph): RelKind | undefined => g.kinds.find((k) => k.couple);

const byBirth = (g: Graph) => (x: string, y: string) =>
  (g.people.get(x)?.born ?? Infinity) - (g.people.get(y)?.born ?? Infinity) ||
  (g.people.get(x)?.title ?? x).localeCompare(g.people.get(y)?.title ?? y);

export const ups = (g: Graph, id: string, k: string): string[] =>
  (g.upMap.get(k)?.get(id) ?? []).map((e) => e.a);
export const downs = (g: Graph, id: string, k: string): string[] =>
  (g.downMap.get(k)?.get(id) ?? []).map((e) => e.b).sort(byBirth(g));
export const equals = (g: Graph, id: string, k: string): string[] =>
  (g.symMap.get(k)?.get(id) ?? []).map((e) => (e.a === id ? e.b : e.a));
export const edgeOf = (g: Graph, k: string, a: string, b: string): Edge | undefined =>
  (g.downMap.get(k)?.get(a) ?? g.symMap.get(k)?.get(a) ?? []).find(
    (e) => (e.a === a && e.b === b) || (!kindNamed(g, k)?.reverse && e.a === b && e.b === a),
  );
export const partners = (g: Graph, id: string): string[] => {
  const k = coupleKind(g);
  return k ? equals(g, id, k.name) : [];
};
export const title = (g: Graph, id: string): string =>
  g.people.get(id)?.title ?? (id.startsWith("?") ? id.slice(1) : id);

/** Everyone below, at any depth. */
export function below(g: Graph, id: string, k: string): Set<string> {
  const out = new Set<string>();
  const walk = (i: string) =>
    downs(g, i, k).forEach((c) => {
      if (!out.has(c)) {
        out.add(c);
        walk(c);
      }
    });
  walk(id);
  return out;
}

/** Everyone above with how many steps up, and the step that leads back down. */
export function above(
  g: Graph,
  id: string,
  k: string,
): Map<string, { dist: number; prev: string | null }> {
  const m = new Map<string, { dist: number; prev: string | null }>([[id, { dist: 0, prev: null }]]);
  const queue = [id];
  while (queue.length) {
    const c = queue.shift()!;
    for (const p of ups(g, c, k)) {
      if (!m.has(p)) {
        m.set(p, { dist: m.get(c)!.dist + 1, prev: c });
        queue.push(p);
      }
    }
  }
  return m;
}

// ---------- Layout ----------

export const CARD_W = 168;
export const CARD_H = 56;

export interface LaidNode {
  key: string;
  /** Across the tree (x when it runs down the page) and along it (y), of the card's centre and top. */
  b: number;
  d: number;
  /** "married in": a partner drawn beside someone of the line. */
  inlaw: boolean;
  owner: string;
  /** Its branch is folded; `hidden` is how many it hides. */
  folded: boolean;
  hidden: number;
}

export interface LaidEdge {
  type: "down" | "couple";
  from: string;
  to: string;
  /** Where the line starts and ends, across and along. */
  ab: number;
  ad: number;
  kb: number;
  kd: number;
  dashed: boolean;
  ended: boolean;
  /** A proposed relation (stage 33): its place in the response's `proposed`. */
  proposal: number | null;
}

export interface Layout {
  nodes: Map<string, LaidNode>;
  edges: LaidEdge[];
  /** Lines drawn over the tree, such as rivals. */
  lines: { kind: string; a: string; b: string }[];
  down: boolean;
  /** Ancestors, drawn upwards from `root`. */
  up: boolean;
  root: string;
  family: boolean;
  /** Each card's top-left corner on the page. */
  rect: (key: string) => { x: number; y: number };
  /** A point across and along, on the page. */
  at: (b: number, d: number) => [number, number];
}

interface Unit {
  id: string;
  units: string[];
  groups: { with: string | null; kids: Unit[] }[];
  folded: boolean;
  hidden: number;
  w: number;
  kb: number;
  unitB: number;
}

/** Lays out a saved tree. `extra` folds and opens branches beyond what the tree file keeps. */
export function layoutTree(g: Graph, t: TreeLine, root?: string): Layout {
  const k = kindNamed(g, t.kind)?.name ?? t.kind;
  const up = t.way === "up";
  const family = !!kindNamed(g, k)?.family;
  const pair = family && !up;
  const down = t.dir === "down";
  const SB = down ? CARD_W : CARD_H;
  const SD = down ? CARD_H : CARD_W;
  const GB = down ? 22 : 14;
  const PG = down ? 34 : 18;
  const GD = down ? 74 : 86;
  const start = root ?? (up ? (t.from ?? t.start) : t.start);
  const blood = up ? new Set<string>([start]) : new Set([start, ...below(g, start, k)]);
  const folded = new Set(t.folded ?? []);
  const opened = new Set(t.opened ?? []);
  const seen = new Set<string>();

  function build(id: string, depth: number): Unit {
    seen.add(id);
    const ps = pair ? partners(g, id).filter((p) => !blood.has(p) && !seen.has(p)) : [];
    ps.forEach((p) => seen.add(p));
    const next = (up ? ups(g, id, k) : downs(g, id, k)).filter((c) => !seen.has(c));
    const units = ps.length >= 2 ? [ps[0]!, id, ...ps.slice(1)] : [id, ...ps];
    const order: (string | null)[] =
      ps.length >= 2 ? [ps[0]!, null, ...ps.slice(1)] : [null, ...ps];
    const byGens =
      !up && t.gens !== undefined && depth >= t.gens - 1 && next.length > 0 && !opened.has(id);
    const isFolded = !up && next.length > 0 && (folded.has(id) || byGens);
    const groups: Unit["groups"] = [];
    for (const w of order) {
      const g2 = next.filter((c) => {
        if (seen.has(c)) return false;
        if (up) return w === null;
        const others = ups(g, c, k).filter((u) => u !== id);
        return w ? others.includes(w) : !others.some((o) => ps.includes(o));
      });
      g2.forEach((c) => seen.add(c));
      if (g2.length)
        groups.push({ with: w, kids: isFolded ? [] : g2.map((c) => build(c, depth + 1)) });
    }
    return {
      id,
      units,
      groups,
      folded: isFolded,
      hidden: isFolded ? below(g, id, k).size : 0,
      w: 0,
      kb: 0,
      unitB: 0,
    };
  }

  const tree = build(start, 0);
  const nodes = new Map<string, LaidNode>();
  const edges: LaidEdge[] = [];

  function measure(n: Unit): number {
    n.unitB = n.units.length * SB + (n.units.length - 1) * PG;
    let kb = 0;
    let c = 0;
    for (const grp of n.groups)
      for (const kid of grp.kids) {
        kb += measure(kid);
        c++;
      }
    if (c) kb += GB * (c - 1);
    n.kb = kb;
    n.w = Math.max(n.unitB, kb);
    return n.w;
  }

  function place(n: Unit, b0: number, depth: number) {
    const d = (up ? -1 : 1) * depth * (SD + GD);
    let cur = b0 + (n.w - n.kb) / 2;
    const all: Unit[] = [];
    for (const grp of n.groups)
      for (const kid of grp.kids) {
        place(kid, cur, depth + 1);
        all.push(kid);
        cur += kid.w + GB;
      }
    let centre = all.length
      ? (nodes.get(all[0]!.id)!.b + nodes.get(all[all.length - 1]!.id)!.b) / 2
      : b0 + n.w / 2;
    centre = Math.max(b0 + n.unitB / 2, Math.min(b0 + n.w - n.unitB / 2, centre));
    let ub = centre - n.unitB / 2 + SB / 2;
    for (const u of n.units) {
      nodes.set(u, {
        key: u,
        b: ub,
        d,
        inlaw: u !== n.id,
        owner: n.id,
        folded: u === n.id && n.folded,
        hidden: u === n.id ? n.hidden : 0,
      });
      ub += SB + PG;
    }
    for (const u of n.units) {
      if (u === n.id) continue;
      const e = edgeOf(g, coupleKind(g)!.name, n.id, u);
      edges.push({
        type: "couple",
        from: n.id,
        to: u,
        ab: 0,
        ad: 0,
        kb: 0,
        kd: 0,
        dashed: false,
        ended: !!e?.how && /ended|divorc|separat|widow/i.test(e.how),
        proposal: e?.proposed ?? null,
      });
    }
    const me = nodes.get(n.id)!;
    for (const grp of n.groups) {
      let ab: number, ad: number;
      if (up) [ab, ad] = [me.b, d];
      else if (grp.with) [ab, ad] = [(me.b + nodes.get(grp.with)!.b) / 2, d + SD / 2];
      else [ab, ad] = [me.b, d + SD];
      for (const kid of grp.kids) {
        const kidNode = nodes.get(kid.id)!;
        const e = up ? edgeOf(g, k, kid.id, n.id) : edgeOf(g, k, n.id, kid.id);
        edges.push({
          type: "down",
          from: n.id,
          to: kid.id,
          ab,
          ad,
          kb: kidNode.b,
          kd: up ? kidNode.d + SD : kidNode.d,
          dashed: !!e?.how && /adopt|foster/i.test(e.how),
          ended: false,
          proposal: e?.proposed ?? null,
        });
      }
    }
  }

  measure(tree);
  place(tree, 0, 0);

  const lines: Layout["lines"] = [];
  for (const name of t.show ?? []) {
    const kind = kindNamed(g, name);
    if (!kind || kind.reverse || (family && kind.couple)) continue;
    const seenLine = new Set<string>();
    for (const e of g.edges) {
      if (e.kind !== kind.name || !nodes.has(e.a) || !nodes.has(e.b)) continue;
      const id = [e.a, e.b].sort().join("|");
      if (seenLine.has(id)) continue;
      seenLine.add(id);
      lines.push({ kind: kind.name, a: e.a, b: e.b });
    }
  }

  const at = (b: number, d: number): [number, number] => (down ? [b, d] : [d, b]);
  const rect = (key: string) => {
    const n = nodes.get(key)!;
    return down ? { x: n.b - CARD_W / 2, y: n.d } : { x: n.d, y: n.b - CARD_H / 2 };
  };
  return { nodes, edges, lines, down, up, root: start, family, rect, at };
}

export function bounds(L: Layout): { x: number; y: number; w: number; h: number } {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const key of L.nodes.keys()) {
    const r = L.rect(key);
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + CARD_W);
    y1 = Math.max(y1, r.y + CARD_H);
  }
  if (x0 === Infinity) return { x: 0, y: 0, w: CARD_W, h: CARD_H };
  return { x: x0 - 40, y: y0 - 60, w: x1 - x0 + 80, h: y1 - y0 + 100 };
}

// ---------- How two are related ----------

const ORD = ["", "first", "second", "third", "fourth", "fifth"];
const TIMES = ["", "once", "twice", "three times"];
const ord = (n: number) => ORD[n] ?? `${n}th`;
const times = (n: number) => TIMES[n] ?? `${n} times`;

/** What B is to A, by steps up from A to the shared ancestor (a) and from B (b). Neutral words. */
export function familyWord(a: number, b: number, half: boolean): string {
  if (a === 0)
    return b === 1 ? "child" : b === 2 ? "grandchild" : `${"great-".repeat(b - 2)}grandchild`;
  if (b === 0)
    return a === 1 ? "parent" : a === 2 ? "grandparent" : `${"great-".repeat(a - 2)}grandparent`;
  if (a === 1 && b === 1) return half ? "half-sibling" : "sibling";
  if (a === 1) return `sibling's ${b === 2 ? "child" : b === 3 ? "grandchild" : "descendant"}`;
  if (b === 1) return `${a === 2 ? "parent's" : a === 3 ? "grandparent's" : "ancestor's"} sibling`;
  const degree = Math.min(a, b) - 1;
  const removed = Math.abs(a - b);
  return `${ord(degree)} cousin${removed ? ` ${times(removed)} removed` : ""}`;
}

export interface Kinship {
  text: string;
  /** Everyone on the way from one to the other, both ends included. */
  path: string[];
}

/** How B is related to A along the tree's kind, in a sentence, with the path between them. */
export function relate(g: Graph, kindName: string, A: string, B: string): Kinship {
  const kind = kindNamed(g, kindName);
  const k = kind?.name ?? kindName;
  const tA = title(g, A);
  const tB = title(g, B);
  if (partners(g, A).includes(B)) return { text: `${tB} and ${tA} are partners.`, path: [A, B] };
  const ma = above(g, A, k);
  const mb = above(g, B, k);
  let best: { id: string; a: number; b: number } | null = null;
  for (const [id, va] of ma) {
    const vb = mb.get(id);
    if (vb && (!best || va.dist + vb.dist < best.a + best.b)) best = { id, a: va.dist, b: vb.dist };
  }
  const chain = (m: typeof ma, id: string) => {
    const out: string[] = [];
    let c: string | null = id;
    while (c) {
      out.push(c);
      c = m.get(c)!.prev;
    }
    return out;
  };
  if (best) {
    const path = [...new Set([...chain(ma, best.id), ...chain(mb, best.id)])];
    if (kind?.family) {
      let half = false;
      if (best.a === 1 && best.b === 1) {
        const pa = ups(g, A, k);
        const pb = ups(g, B, k);
        half = !(pa.length === pb.length && pa.every((p) => pb.includes(p)));
      }
      const adopted = best.a === 0 && best.b === 1 && /adopt/i.test(edgeOf(g, k, A, B)?.how ?? "");
      return {
        text: `${tB} is ${tA}'s ${adopted ? "adopted child" : familyWord(best.a, best.b, half)}.`,
        path,
      };
    }
    const verb = kind?.name ?? k;
    const steps = (n: number) => `${n} step${n > 1 ? "s" : ""}`;
    if (best.a === 0) return { text: `${tB} is ${steps(best.b)} below ${tA} (${verb}).`, path };
    if (best.b === 0) return { text: `${tB} is ${steps(best.a)} above ${tA} (${verb}).`, path };
    return {
      text: `${tA} and ${tB} meet at ${title(g, best.id)}, ${steps(best.a)} and ${steps(best.b)} up.`,
      path,
    };
  }
  if (kind?.family) {
    const strip = (s: string) => s.slice(s.indexOf("'s ") + 3).replace(/\.$/, "");
    for (const p of partners(g, B)) {
      const r = relate(g, k, A, p);
      if (r.text.includes("'s ") && !r.text.includes("partner")) {
        return { text: `${tB} is the partner of ${tA}'s ${strip(r.text)}.`, path: [...r.path, B] };
      }
    }
    for (const p of partners(g, A)) {
      const r = relate(g, k, p, B);
      if (r.text.includes("'s ") && !r.text.includes("partner")) {
        return { text: `${tB} is ${tA}'s partner's ${strip(r.text)}.`, path: [A, ...r.path] };
      }
    }
  }
  return { text: `${tA} and ${tB} are not related in this tree.`, path: [A, B] };
}

// ---------- Checks ----------

export interface Warning {
  /** "check|entry|other", the key "It's right" keeps. */
  key: string;
  text: string;
}

/** What does not fit about one person: dates against a parent, and entries that disagree. */
export function warningsOf(g: Graph, kindName: string, id: string, fine: string[] = []): Warning[] {
  const out: Warning[] = [];
  const kind = kindNamed(g, kindName);
  const me = g.people.get(id);
  const first = (key: string) => title(g, key).split(" ")[0];
  if (kind?.family && me?.born != null) {
    for (const p of ups(g, id, kind.name)) {
      const pe = g.people.get(p);
      if (!pe) continue;
      if (pe.born != null && me.born - pe.born < 14) {
        out.push({
          key: `young|${id}|${p}`,
          text: `Born in ${me.born}, when ${first(p)} was ${me.born - pe.born}.`,
        });
      } else if (pe.died != null && me.born > pe.died + 1) {
        out.push({
          key: `late|${id}|${p}`,
          text: `Born in ${me.born}, ${me.born - pe.died} years after ${first(p)} died.`,
        });
      }
    }
  }
  for (const f of g.facts) {
    if (f.disagree && (f.a === id || f.b === id))
      out.push({ key: `differ|${f.a}|${f.b}`, text: f.disagree });
  }
  return out.filter((w) => !fine.includes(w.key));
}

/** A card read out in full: "Wren Vane, born 268, child of Corin Vane and Ilsa Thorne, 2 partners". */
export function describe(g: Graph, kindName: string, id: string, fine: string[] = []): string {
  const kind = kindNamed(g, kindName);
  const k = kind?.name ?? kindName;
  const p = g.people.get(id);
  const parts = [title(g, id)];
  if (!p?.path) parts.push("no entry yet");
  if (p?.born != null) parts.push(`born ${p.born}`);
  if (p?.died != null) parts.push(`died ${p.died}`);
  const ab = ups(g, id, k);
  if (ab.length)
    parts.push(
      `${kind?.family ? "child of" : (kind?.name ?? k)} ${ab.map((x) => title(g, x)).join(" and ")}`,
    );
  if (kind?.family) {
    const ps = partners(g, id);
    if (ps.length) parts.push(`${ps.length} ${ps.length > 1 ? "partners" : "partner"}`);
  }
  const bl = downs(g, id, k);
  if (bl.length)
    parts.push(
      kind?.family ? `${bl.length} ${bl.length > 1 ? "children" : "child"}` : `${bl.length} below`,
    );
  for (const w of warningsOf(g, k, id, fine)) parts.push(`doesn't fit: ${w.text}`);
  return parts.join(", ");
}

/** People in families already written: who has the most below them, for "Make a tree from…". */
export function biggestFamily(g: Graph): { start: string; size: number } | null {
  const fam = g.kinds.find((k) => k.family);
  if (!fam) return null;
  let best: { start: string; size: number } | null = null;
  for (const key of g.people.keys()) {
    if (ups(g, key, fam.name).length > 0 || !g.people.get(key)?.path) continue;
    const size = below(g, key, fam.name).size + 1;
    if (size > 1 && (!best || size > best.size)) best = { start: key, size };
  }
  return best;
}
