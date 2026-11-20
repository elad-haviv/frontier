/**
 * A small buffer in the browser, so text typed while the server cannot be reached is not lost.
 * Each entry holds the latest unsent text of one file and is removed once the server has it.
 */
const key = (path: string) => `frontier:draft:${path}`;

export interface Buffered {
  id: string;
  text: string;
  /** The revision the server had when this text was typed. */
  revision: number;
}

export function readBuffer(path: string): Buffered | null {
  try {
    const raw = localStorage.getItem(key(path));
    return raw ? (JSON.parse(raw) as Buffered) : null;
  } catch {
    return null;
  }
}

export function writeBuffer(path: string, value: Buffered): void {
  try {
    localStorage.setItem(key(path), JSON.stringify(value));
  } catch {
    /* Storage is full or switched off; the server save still runs. */
  }
}

export function clearBuffer(path: string): void {
  try {
    localStorage.removeItem(key(path));
  } catch {
    /* nothing to clear */
  }
}
