/**
 * Draws a system model on a canvas: orbits, then belts, then bodies from far to near, with the
 * star's glow. Distances are drawn closer together by default and sizes are symbolic, which the
 * foot of the canvas says. The canvas is dark in both themes, so these colours are fixed.
 */
import {
  type Body,
  type Point,
  type Scale,
  TAU,
  companion,
  drawnPosition,
  drawnRadius,
  isLocal,
  isStar,
  localRadius,
  meanAnomaly,
  orbitAt,
  period,
  primary,
  totalMass,
  PRESETS,
  systemRadius,
} from "../../map/orbits.ts";
import { SKY } from "./drawStars.ts";

const SERIF = '"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif';
const SANS = 'system-ui,-apple-system,"Segoe UI",Roboto,sans-serif';
const MONO = "ui-monospace,Menlo,Consolas,monospace";

export interface SystemCamera {
  /** The system point at the centre of the screen, in pixels at zoom 1. */
  cx: number;
  cy: number;
  zoom: number;
  /** Seen at an angle (the circles are ellipses) or from straight above. */
  tilt: boolean;
}

export interface Look {
  name: string;
  colour: string;
}

export interface SystemDraw {
  bodies: Body[];
  looks: Map<string, Look>;
  cam: SystemCamera;
  day: number;
  scale: Scale;
  width: number;
  height: number;
  selected: string | null;
  hover: string | null;
  show: { names: boolean; orbits: boolean; zone: boolean };
  /** Adding: the orbit the new body would have, drawn dashed where the pointer is. */
  ghost: { type: Body["type"]; parent: string | null; px: number; angle: number } | null;
  phone: boolean;
  /** The body the view follows, if any. */
  follow: string | null;
}

export interface SystemDrawn {
  /** Each body drawn: where, and how far a press reaches it. */
  bodies: { id: string; x: number; y: number; reach: number }[];
  zoomToFit: number;
}

export const tiltOf = (cam: SystemCamera) => (cam.tilt ? 0.52 : 1);
export const toScreen = (cam: SystemCamera, p: Point, w: number, h: number): Point => ({
  x: w / 2 + (p.x - cam.cx) * cam.zoom,
  y: h / 2 + (p.y - cam.cy) * cam.zoom * tiltOf(cam),
});
export const fromScreen = (
  cam: SystemCamera,
  x: number,
  y: number,
  w: number,
  h: number,
): Point => ({
  x: (x - w / 2) / cam.zoom + cam.cx,
  y: (y - h / 2) / (cam.zoom * tiltOf(cam)) + cam.cy,
});

/** The zoom at which the whole system fits the screen. */
export function fitZoom(bodies: Body[], scale: Scale, w: number, h: number, tilt: boolean): number {
  const r = systemRadius(bodies, scale);
  return Math.min((w * 0.45) / r, (h * 0.45) / (r * (tilt ? 0.52 : 1)));
}

function text(
  ctx: CanvasRenderingContext2D,
  words: string,
  x: number,
  y: number,
  major: boolean,
  alpha = 1,
) {
  ctx.font = major ? `600 13px ${SERIF}` : `500 12px ${SANS}`;
  ctx.lineWidth = 3;
  ctx.lineJoin = "round";
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = SKY.edge;
  ctx.strokeText(words, x, y);
  ctx.fillStyle = SKY.ink;
  ctx.fillText(words, x, y);
  ctx.globalAlpha = 1;
}

const hash = (i: number) => {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

export function drawSystem(ctx: CanvasRenderingContext2D, d: SystemDraw): SystemDrawn {
  const { bodies, cam, day, scale, width: W, height: H } = d;
  const k = tiltOf(cam);
  const S = (p: Point) => toScreen(cam, p, W, H);
  const out: SystemDrawn = { bodies: [], zoomToFit: fitZoom(bodies, scale, W, H, cam.tilt) };
  const byId = new Map(bodies.map((b) => [b.id, b]));

  const g = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.7);
  g.addColorStop(0, SKY.centre);
  g.addColorStop(1, SKY.edge);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = SKY.ink;
  for (let i = 0; i < 220; i++) {
    ctx.globalAlpha = 0.06 + hash(i + 5) * 0.12;
    ctx.fillRect(hash(i) * W, hash(i + 400) * H, 1.2, 1.2);
  }
  ctx.globalAlpha = 1;

  const ellipse = (cx: number, cy: number, r: number) => {
    const p = S({ x: cx, y: cy });
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, r * cam.zoom, r * cam.zoom * k, 0, 0, TAU);
  };

  // The mild zone: where water could stay liquid, a band about the star.
  const star = primary(bodies);
  if (d.show.zone && star) {
    const L = totalMass(bodies) ** 3.5;
    const inner = drawnRadius(0.95 * Math.sqrt(L), scale);
    const outer = drawnRadius(1.6 * Math.sqrt(L), scale);
    ctx.fillStyle = "#7fb3a6";
    ctx.globalAlpha = 0.13;
    ellipse(0, 0, outer);
    const o = S({ x: 0, y: 0 });
    ctx.ellipse(o.x, o.y, inner * cam.zoom, inner * cam.zoom * k, 0, 0, TAU, true);
    ctx.fill("evenodd");
    ctx.globalAlpha = 1;
  }

  const pos = new Map<string, Point>();
  for (const b of bodies) pos.set(b.id, drawnPosition(b, day, bodies, scale));
  const pair = companion(bodies);
  if (pair && d.show.orbits) {
    const apart = drawnRadius(pair.a, scale);
    const total = totalMass(bodies);
    ctx.strokeStyle = SKY.ink;
    ctx.globalAlpha = 0.22;
    ctx.lineWidth = 1;
    ellipse(0, 0, (apart * pair.mass) / total);
    ctx.stroke();
    ellipse(0, 0, (apart * (star?.mass ?? 1)) / total);
    ctx.stroke();
    ctx.globalAlpha = 1;
    const c = S({ x: 0, y: 0 });
    ctx.strokeStyle = SKY.soft;
    ctx.beginPath();
    ctx.moveTo(c.x - 4, c.y);
    ctx.lineTo(c.x + 4, c.y);
    ctx.moveTo(c.x, c.y - 4);
    ctx.lineTo(c.x, c.y + 4);
    ctx.stroke();
  }

  const zoomedIn = cam.zoom >= out.zoomToFit * 1.25;
  const orbitPath = (b: Body, origin: Point) => {
    ctx.beginPath();
    for (let i = 0; i <= 120; i++) {
      const o = orbitAt(b, (i / 120) * TAU);
      const r = isLocal(b, bodies) ? localRadius(o.r) : drawnRadius(o.r, scale);
      const p = S({ x: origin.x + r * Math.cos(o.theta), y: origin.y + r * Math.sin(o.theta) });
      if (i) ctx.lineTo(p.x, p.y);
      else ctx.moveTo(p.x, p.y);
    }
  };
  for (const b of bodies) {
    if (!b.parent || isStar(b)) continue;
    const on = d.selected === b.id;
    const hov = d.hover === b.id;
    if (b.type === "belt") {
      ctx.fillStyle = PRESETS.belt.colour;
      const turn = (TAU * day) / period(b, bodies);
      for (let i = 0; i < 320; i++) {
        const r = drawnRadius(b.inner + (b.outer - b.inner) * hash(i + b.inner * 10), scale);
        const th = hash(i + 50) * TAU + turn;
        const p = S({ x: r * Math.cos(th), y: r * Math.sin(th) });
        ctx.globalAlpha = on ? 0.8 : hov ? 0.6 : 0.38;
        ctx.fillRect(p.x, p.y, 1.3, 1.3);
      }
      ctx.globalAlpha = 1;
      if (on) {
        ctx.strokeStyle = SKY.select;
        ctx.lineWidth = 1.2;
        ellipse(0, 0, drawnRadius(b.inner, scale));
        ctx.stroke();
        ellipse(0, 0, drawnRadius(b.outer, scale));
        ctx.stroke();
      }
      continue;
    }
    const local = isLocal(b, bodies);
    if (local && !zoomedIn && !on) continue;
    if (!d.show.orbits && !on) continue;
    const origin = local ? (pos.get(b.parent) ?? { x: 0, y: 0 }) : { x: 0, y: 0 };
    ctx.strokeStyle = on ? SKY.select : SKY.ink;
    ctx.globalAlpha = on ? 0.9 : hov ? 0.45 : local ? 0.16 : 0.22;
    ctx.lineWidth = on ? 1.5 : 1;
    if (b.type === "comet" && !on) ctx.setLineDash([3, 4]);
    orbitPath(b, origin);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  // Adding: the orbit the new body would take, and where it would sit.
  const gh = d.ghost;
  if (gh) {
    ctx.strokeStyle = SKY.select;
    ctx.lineWidth = 1.4;
    ctx.setLineDash([4, 4]);
    const parentPos = gh.parent ? (pos.get(gh.parent) ?? { x: 0, y: 0 }) : { x: 0, y: 0 };
    const origin =
      gh.parent && byId.get(gh.parent) && !isStar(byId.get(gh.parent)!)
        ? parentPos
        : { x: 0, y: 0 };
    if (gh.type === "belt") {
      ellipse(0, 0, gh.px * 0.88);
      ctx.stroke();
      ellipse(0, 0, gh.px * 1.12);
      ctx.stroke();
    } else {
      ellipse(origin.x, origin.y, gh.px);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    if (gh.type !== "belt") {
      const p = S({
        x: origin.x + gh.px * Math.cos(gh.angle),
        y: origin.y + gh.px * Math.sin(gh.angle),
      });
      ctx.fillStyle = PRESETS[gh.type].colour;
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      ctx.arc(p.x, p.y, PRESETS[gh.type].radius || 4, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  // Bodies, far side first.
  const zs = Math.max(0.8, Math.min(1.9, Math.pow(cam.zoom / out.zoomToFit, 0.35)));
  const order = bodies
    .filter((b) => b.type !== "belt")
    .sort((a, b) => pos.get(a.id)!.y - pos.get(b.id)!.y);
  const nearestStar = (p: Point): Point => {
    if (!pair || !star) return pos.get(star?.id ?? "") ?? { x: 0, y: 0 };
    const a = pos.get(star.id)!;
    const c = pos.get(pair.id)!;
    return Math.hypot(p.x - a.x, p.y - a.y) < Math.hypot(p.x - c.x, p.y - c.y) ? a : c;
  };
  for (const b of order) {
    const look = d.looks.get(b.id);
    if (!look) continue;
    const local = isLocal(b, bodies);
    const on = d.selected === b.id;
    if (local && !zoomedIn && !on) continue;
    const p = S(pos.get(b.id)!);
    const r = (PRESETS[b.type].radius || 4) * zs;
    out.bodies.push({ id: b.id, x: p.x, y: p.y, reach: r + 5 });
    const sp = S(isStar(b) ? { x: 0, y: 0 } : nearestStar(pos.get(b.id)!));
    const ux = p.x - sp.x;
    const uy = p.y - sp.y;
    const ul = Math.hypot(ux, uy) || 1;
    if (isStar(b)) {
      const gg = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 3.2);
      gg.addColorStop(0, look.colour);
      gg.addColorStop(0.3, look.colour);
      gg.addColorStop(1, "rgba(0,0,0,0)");
      ctx.globalAlpha = 0.38;
      ctx.fillStyle = gg;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * 3.2, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = look.colour;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, TAU);
      ctx.fill();
    } else if (b.type === "station") {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = look.colour;
      ctx.fillRect(-r, -r, r * 2, r * 2);
      ctx.restore();
    } else {
      if (b.type === "comet") {
        // The tail points away from the star, whichever way the comet goes.
        const o = orbitAt(b, meanAnomaly(b, day, bodies));
        const len = Math.max(8, Math.min(60, 140 / o.r));
        const tail = ctx.createLinearGradient(
          p.x,
          p.y,
          p.x + (ux / ul) * len,
          p.y + (uy / ul) * len,
        );
        tail.addColorStop(0, "rgba(223,230,238,.7)");
        tail.addColorStop(1, "rgba(223,230,238,0)");
        ctx.strokeStyle = tail;
        ctx.lineWidth = 2.4;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x + (ux / ul) * len, p.y + (uy / ul) * len);
        ctx.stroke();
      }
      // A flat disc with one soft shadow on the side away from the star.
      ctx.save();
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, TAU);
      ctx.fillStyle = look.colour;
      ctx.fill();
      ctx.clip();
      ctx.fillStyle = "rgba(10,10,16,.34)";
      ctx.beginPath();
      ctx.arc(p.x + (ux / ul) * r * 0.75, p.y + (uy / ul) * r * 0.75, r * 1.05, 0, TAU);
      ctx.fill();
      ctx.restore();
      if (b.type === "gas" && b.mass > 0 && look.colour) {
        // Gas giants wear a ring in their own colour.
        ctx.strokeStyle = look.colour;
        ctx.globalAlpha = 0.65;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, r * 1.9, r * 0.55, -0.3, 0, TAU);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
    if (d.hover === b.id && !on) {
      ctx.strokeStyle = SKY.select;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r + 5, 0, TAU);
      ctx.stroke();
    }
    if (on) {
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = SKY.paper;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r + 3, 0, TAU);
      ctx.stroke();
      ctx.lineWidth = 2;
      ctx.strokeStyle = SKY.select;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r + 5.5, 0, TAU);
      ctx.stroke();
    }
    if (d.show.names || on || d.hover === b.id) {
      const big = isStar(b) || b.type === "gas" || b.home;
      if (!local || cam.zoom > out.zoomToFit * 1.7 || on)
        text(ctx, look.name, p.x + r + 7, p.y + 4, big, local ? 0.85 : 1);
    }
  }
  if (d.show.names) {
    for (const b of bodies) {
      if (b.type !== "belt") continue;
      const p = S({ x: 0, y: -drawnRadius(b.outer, scale) });
      text(ctx, d.looks.get(b.id)?.name ?? "Belt", p.x - 20, p.y - 6, false, 0.75);
    }
  }
  if (!d.phone) {
    ctx.font = `10px ${MONO}`;
    ctx.fillStyle = SKY.soft;
    ctx.fillText(
      scale === "schematic"
        ? "Distances drawn closer together. Sizes are not to scale."
        : "True distances. Sizes are not to scale.",
      12,
      H - 12,
    );
  }
  return out;
}
