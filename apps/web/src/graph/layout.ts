/**
 * Where each shown node sits: d3-force with fixed forces, from start points seeded by each path, so
 * the same graph lays out the same way on every visit and device without storing positions.
 *
 * The layout only ticks; `runner.ts` decides when, in slices of a frame. It runs in Node too, so
 * the tests count its ticks directly.
 */
import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import type { GraphModel, Shown } from "./model.ts";

/** d3's own end of a layout. */
const ALPHA_MIN = 0.001;
/** So that a cold start, from alpha 1 down to ALPHA_MIN, takes exactly 200 ticks. */
export const ALPHA_DECAY = 1 - ALPHA_MIN ** (1 / 200);
/** A warm restart: from 0.1 until below 0.01, which takes 67 ticks. */
const WARM = { alpha: 0.1, until: 0.01 };

export interface Point {
  x: number;
  y: number;
}

export interface LayoutNode extends SimulationNodeDatum {
  /** The node's index in the model, and its path, by which its place is kept. */
  i: number;
  path: string;
  /** Its radius in graph units. */
  r: number;
}

/** A node's radius in CSS pixels at zoom 1, from its number of distinct shown neighbours. */
export const radiusOf = (degree: number): number => Math.min(14, 3 + 1.6 * Math.sqrt(degree));

/** 32-bit FNV-1a of a text. */
export function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * A node's start: the two halves of its path's hash give an angle and a radius in a disc of radius
 * 10·√n, spread evenly over its area.
 */
export function seedOf(path: string, n: number): Point {
  const h = fnv1a(path);
  const angle = ((h & 0xffff) / 0x10000) * 2 * Math.PI;
  const radius = 10 * Math.sqrt(n) * Math.sqrt((h >>> 16) / 0x10000);
  return { x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
}

export class Layout {
  nodes: LayoutNode[] = [];
  /** Positions by path, kept across changes of what is shown. */
  readonly held = new Map<string, Point>();
  private sim: Simulation<LayoutNode, SimulationLinkDatum<LayoutNode>> | null = null;
  private until = ALPHA_MIN;
  ticks = 0;

  /** Whether the layout has come to rest. */
  get done(): boolean {
    return this.sim === null || this.sim.alpha() < this.until;
  }

  /**
   * Lays out what is shown. Nodes already placed keep their places and the layout restarts warm;
   * otherwise it starts cold from the seeded points. A centre, for the local graph, is fixed in
   * the middle.
   */
  set(model: GraphModel, shown: Shown, centre: number | null = null): void {
    const placed = shown.nodes.some((i) => this.held.has(model.nodes[i]!.path));
    const nodes: LayoutNode[] = shown.nodes.map((i) => {
      const path = model.nodes[i]!.path;
      const at = this.held.get(path) ?? seedOf(path, shown.nodes.length);
      const node: LayoutNode = { i, path, r: radiusOf(shown.degree[i]!), x: at.x, y: at.y };
      if (i === centre) {
        node.fx = 0;
        node.fy = 0;
      }
      return node;
    });
    const byIndex = new Map(nodes.map((n) => [n.i, n]));
    // Each linked pair once, whichever way it links.
    const pairs = new Map<string, SimulationLinkDatum<LayoutNode>>();
    for (const [a, b] of shown.edges) {
      const key = a < b ? `${a} ${b}` : `${b} ${a}`;
      if (!pairs.has(key)) pairs.set(key, { source: byIndex.get(a)!, target: byIndex.get(b)! });
    }

    this.sim?.stop();
    this.nodes = nodes;
    this.sim = forceSimulation(nodes)
      .stop()
      .velocityDecay(0.4)
      .alphaDecay(ALPHA_DECAY)
      .alphaMin(ALPHA_MIN)
      .force("link", forceLink([...pairs.values()]).distance(40))
      .force("charge", forceManyBody<LayoutNode>().strength(-60).theta(0.9).distanceMax(400))
      .force("x", forceX<LayoutNode>(0).strength(0.05))
      .force("y", forceY<LayoutNode>(0).strength(0.05))
      .force(
        "collide",
        forceCollide<LayoutNode>((n) => n.r + 2),
      );
    this.ticks = 0;
    if (placed) {
      this.sim.alpha(WARM.alpha);
      this.until = WARM.until;
    } else {
      this.sim.alpha(1);
      this.until = ALPHA_MIN;
    }
    this.keep();
  }

  /** One tick; nothing once the layout is at rest. */
  tick(): void {
    if (this.done) return;
    this.sim!.tick();
    this.ticks++;
    this.keep();
  }

  /** Runs to the end at once. */
  finish(): void {
    while (!this.done) this.tick();
  }

  /** The current place of a node by path. */
  at(path: string): Point | undefined {
    return this.held.get(path);
  }

  private keep(): void {
    for (const n of this.nodes) this.held.set(n.path, { x: n.x!, y: n.y! });
  }
}
