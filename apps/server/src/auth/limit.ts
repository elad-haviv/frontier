import { isIPv6 } from "node:net";
import { ApiError } from "../errors.js";

/** How many addresses are remembered at most; the oldest are forgotten first beyond it. */
const MAX_ADDRESSES = 10_000;

/**
 * What an address is counted under. An IPv4 address stands for itself (also when it arrives
 * wrapped in IPv6, as `::ffff:1.2.3.4`). An IPv6 address is counted by its first 64 bits: one
 * network (a home or an office) is given a whole /64, so one person cannot get a fresh allowance
 * for every address in it.
 */
export function limitKey(address: string): string {
  const plain = address.split("%")[0]!.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(plain);
  if (mapped) return mapped[1]!;
  if (!isIPv6(plain)) return address;
  const [head = "", tail] = plain.split("::");
  const front = head === "" ? [] : head.split(":");
  const back = tail === undefined || tail === "" ? [] : tail.split(":");
  const groups =
    tail === undefined
      ? front
      : [
          ...front,
          ...Array<string>(Math.max(0, 8 - front.length - back.length)).fill("0"),
          ...back,
        ];
  return `${groups
    .slice(0, 4)
    .map((g) => g.replace(/^0+(?=.)/, ""))
    .join(":")}::/64`;
}

/**
 * Counts login attempts per network address, whichever way the login is tried, so a passkey
 * attempt and a password attempt draw on the same allowance.
 */
export class LoginLimiter {
  private attempts = new Map<string, { count: number; start: number }>();
  private nextSweep = 0;

  constructor(
    private readonly max = 5,
    private readonly windowMs = 15 * 60 * 1000,
    private readonly now: () => number = Date.now,
    private readonly capacity = MAX_ADDRESSES,
  ) {}

  /** How many addresses are held now (for tests). */
  get size(): number {
    return this.attempts.size;
  }

  /** Forgets addresses whose window has passed. */
  private sweep(now: number): void {
    for (const [key, a] of this.attempts) {
      // Oldest first: the first one still running means all the rest are.
      if (a.start + this.windowMs > now) break;
      this.attempts.delete(key);
    }
    this.nextSweep = now + this.windowMs / 10;
  }

  /** Counts one attempt and refuses it when the address has used its allowance. */
  attempt(address: string): void {
    const now = this.now();
    // Looked through now and then, not on every attempt: an entry whose window passed is also
    // started afresh when its own address comes back, so a late sweep costs nothing.
    if (now >= this.nextSweep) this.sweep(now);
    const key = limitKey(address);
    let current = this.attempts.get(key);
    if (current && current.start + this.windowMs <= now) current = undefined;
    if (!current) {
      this.attempts.delete(key);
      // Never more than `capacity` addresses: the one longest held makes room.
      if (this.attempts.size >= this.capacity) {
        const oldest = this.attempts.keys().next().value;
        if (oldest !== undefined) this.attempts.delete(oldest);
      }
      current = { count: 0, start: now };
    }
    current.count++;
    this.attempts.set(key, current);
    if (current.count > this.max) {
      throw new ApiError("rate_limited", "Too many attempts. Wait 15 minutes and try again.");
    }
  }
}
