import { ApiError } from "../errors.js";

/**
 * Counts login attempts per network address, whichever way the login is tried, so a passkey
 * attempt and a password attempt draw on the same allowance.
 */
export class LoginLimiter {
  private attempts = new Map<string, { count: number; start: number }>();

  constructor(
    private readonly max = 5,
    private readonly windowMs = 15 * 60 * 1000,
    private readonly now: () => number = Date.now,
  ) {}

  /** Counts one attempt and refuses it when the address has used its allowance. */
  attempt(address: string): void {
    const now = this.now();
    // Forget addresses whose window has passed, so the list cannot grow without end.
    for (const [key, a] of this.attempts) {
      if (a.start + this.windowMs <= now) this.attempts.delete(key);
    }
    const current = this.attempts.get(address) ?? { count: 0, start: now };
    current.count++;
    this.attempts.set(address, current);
    if (current.count > this.max) {
      throw new ApiError("rate_limited", "Too many attempts. Wait 15 minutes and try again.");
    }
  }
}
