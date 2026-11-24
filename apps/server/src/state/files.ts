/**
 * File writing for /data/state. A file is written under a temporary name and then renamed, so a
 * crash cannot leave half a file. One server process is the only writer.
 */
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ZodType, ZodTypeDef } from "zod";

export class StateFiles {
  private listeners: (() => void)[] = [];

  /** Registers a function called after every write or removal. The backup uses it. */
  onChange(listener: () => void): void {
    this.listeners.push(listener);
  }

  private changed(): void {
    for (const l of this.listeners) l();
  }

  async write(path: string, data: Buffer | string): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    const temp = `${path}.${randomBytes(6).toString("hex")}.tmp`;
    try {
      await writeFile(temp, data);
      await rename(temp, path);
    } catch (err) {
      await rm(temp, { force: true });
      throw err;
    }
    this.changed();
  }

  async writeJson(path: string, value: unknown): Promise<void> {
    await this.write(path, JSON.stringify(value, null, 2) + "\n");
  }

  /** Reads and checks a JSON file. Returns null when the file does not exist. */
  async readJson<T>(path: string, schema: ZodType<T, ZodTypeDef, unknown>): Promise<T | null> {
    if (!existsSync(path)) return null;
    return schema.parse(JSON.parse(await readFile(path, "utf8")));
  }

  async remove(path: string): Promise<void> {
    await rm(path, { recursive: true, force: true });
    this.changed();
  }
}
