/**
 * Where backups go. A target is a flat store of named files: a folder for tests and local runs,
 * an S3-compatible bucket for a real deployment.
 */
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { S3Config } from "../config.js";

export interface BackupTarget {
  put(key: string, data: Buffer): Promise<void>;
  /** The data under a key, or null when there is none. */
  get(key: string): Promise<Buffer | null>;
  /** Every key that starts with the prefix. */
  list(prefix: string): Promise<string[]>;
  remove(key: string): Promise<void>;
}

export class FolderTarget implements BackupTarget {
  constructor(private readonly dir: string) {}

  async put(key: string, data: Buffer): Promise<void> {
    const path = join(this.dir, key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
  }

  async get(key: string): Promise<Buffer | null> {
    const path = join(this.dir, key);
    return existsSync(path) ? readFile(path) : null;
  }

  async list(prefix: string): Promise<string[]> {
    const out: string[] = [];
    const walk = async (rel: string): Promise<void> => {
      const full = join(this.dir, rel);
      if (!existsSync(full)) return;
      for (const name of await readdir(full)) {
        const child = rel === "" ? name : `${rel}/${name}`;
        if ((await stat(join(this.dir, child))).isDirectory()) await walk(child);
        else if (child.startsWith(prefix)) out.push(child);
      }
    };
    await walk("");
    return out.sort();
  }

  async remove(key: string): Promise<void> {
    await rm(join(this.dir, key), { force: true });
  }
}

/* c8 ignore start -- needs a real bucket; tried by hand at the first deploy. */
export class S3Target implements BackupTarget {
  private readonly client: S3Client;

  constructor(private readonly config: S3Config) {
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: config.pathStyle,
      credentials: { accessKeyId: config.accessKey, secretAccessKey: config.secretKey },
    });
  }

  async put(key: string, data: Buffer): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.config.bucket, Key: key, Body: data }),
    );
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      const res = await this.client.send(
        new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
      );
      return res.Body ? Buffer.from(await res.Body.transformToByteArray()) : null;
    } catch (err) {
      if ((err as { name?: string }).name === "NoSuchKey") return null;
      throw err;
    }
  }

  async list(prefix: string): Promise<string[]> {
    const out: string[] = [];
    let token: string | undefined;
    do {
      const res = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.config.bucket,
          Prefix: prefix,
          ContinuationToken: token,
        }),
      );
      for (const item of res.Contents ?? []) if (item.Key) out.push(item.Key);
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);
    return out.sort();
  }

  async remove(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }));
  }
}
/* c8 ignore stop */
