// Object storage (spec §4.1): raw MIME, attachments and import files. Keys are opaque paths such
// as `imports/wsp_…/imp_….csv`. The filesystem store suits one host or a shared volume; S3 or MinIO
// (through `@aws-sdk/client-s3`, §4.2) is the production target (§4.5), behind the same interface.

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';

import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client, S3ServiceException } from '@aws-sdk/client-s3';
import { dirname, join, resolve, sep } from 'node:path';

export interface ObjectStorage {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  /** The object's bytes; throws `ObjectNotFound` when there is none. */
  get(key: string): Promise<Buffer>;
  /** Removes the object; no error when it is already gone. */
  delete(key: string): Promise<void>;
}

export class ObjectNotFound extends Error {}

const SAFE_KEY = /^[A-Za-z0-9_./-]+$/;

function checkKey(key: string): void {
  if (!SAFE_KEY.test(key) || key.split('/').some((part) => part === '' || part === '.' || part === '..')) throw new Error(`Unsafe storage key: ${key}`);
}

export class FileSystemStorage implements ObjectStorage {
  readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  #path(key: string): string {
    checkKey(key);
    const path = resolve(join(this.root, key));
    if (!path.startsWith(this.root + sep)) throw new Error(`Unsafe storage key: ${key}`);
    return path;
  }

  async put(key: string, body: Buffer): Promise<void> {
    const path = this.#path(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  }

  async get(key: string): Promise<Buffer> {
    try {
      return await readFile(this.#path(key));
    } catch (error) {
      if ((error as { code?: string }).code === 'ENOENT') throw new ObjectNotFound(key);
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.#path(key), { force: true });
  }
}

export class MemoryStorage implements ObjectStorage {
  readonly objects = new Map<string, { body: Buffer; contentType: string }>();

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    checkKey(key);
    this.objects.set(key, { body: Buffer.from(body), contentType });
  }

  async get(key: string): Promise<Buffer> {
    const object = this.objects.get(key);
    if (!object) throw new ObjectNotFound(key);
    return Buffer.from(object.body);
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }
}

export interface S3StorageOptions {
  bucket: string;
  region?: string;
  /** For MinIO or another S3-compatible store; implies path-style URLs. */
  endpoint?: string;
  forcePathStyle?: boolean;
  /** Without these, the SDK's usual chain (environment, profile, instance role) is used. */
  credentials?: { accessKeyId: string; secretAccessKey: string };
}

/** S3 or MinIO. Objects are private; nothing is ever served from the bucket directly. */
export class S3Storage implements ObjectStorage {
  readonly bucket: string;
  readonly client: S3Client;

  constructor(options: S3StorageOptions) {
    this.bucket = options.bucket;
    this.client = new S3Client({
      region: options.region ?? 'us-east-1',
      ...(options.endpoint && { endpoint: options.endpoint }),
      forcePathStyle: options.forcePathStyle ?? Boolean(options.endpoint),
      ...(options.credentials && { credentials: options.credentials }),
    });
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    checkKey(key);
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }));
  }

  async get(key: string): Promise<Buffer> {
    checkKey(key);
    try {
      const object = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      return Buffer.from(await object.Body!.transformToByteArray());
    } catch (error) {
      if (error instanceof S3ServiceException && (error.name === 'NoSuchKey' || error.$metadata.httpStatusCode === 404)) throw new ObjectNotFound(key);
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    checkKey(key);
    // S3 answers a delete of a missing key with success, as this interface asks.
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

/**
 * The store configured by the environment: S3 or MinIO when `S3_BUCKET` is set (`S3_REGION`,
 * `S3_ENDPOINT` for MinIO, `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY`, or the SDK's own
 * credentials), otherwise the filesystem at `STORAGE_DIR` (default `.storage`).
 */
export function storageFromEnv(env: NodeJS.ProcessEnv = process.env): ObjectStorage {
  if (env.S3_BUCKET) {
    return new S3Storage({
      bucket: env.S3_BUCKET,
      ...(env.S3_REGION && { region: env.S3_REGION }),
      ...(env.S3_ENDPOINT && { endpoint: env.S3_ENDPOINT }),
      ...(env.S3_FORCE_PATH_STYLE && { forcePathStyle: env.S3_FORCE_PATH_STYLE === 'true' }),
      ...(env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY && { credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY } }),
    });
  }
  return new FileSystemStorage(env.STORAGE_DIR ?? '.storage');
}
