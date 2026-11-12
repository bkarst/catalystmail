import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, it } from 'vitest';

import { FileSystemStorage, MemoryStorage, ObjectNotFound, S3Storage, storageFromEnv, type ObjectStorage } from './index.ts';

const dirs: string[] = [];
afterAll(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});

for (const [name, make] of [
  ['MemoryStorage', async () => new MemoryStorage()],
  ['FileSystemStorage', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'catalyst-storage-'));
    dirs.push(dir);
    return new FileSystemStorage(dir);
  }],
] as [string, () => Promise<ObjectStorage>][]) {
  describe(name, () => {
    it('stores, reads and deletes objects by key', async () => {
      const storage = await make();
      await storage.put('imports/wsp_1/imp_1.csv', Buffer.from('email\na@b.com\n'), 'text/csv');
      assert.equal((await storage.get('imports/wsp_1/imp_1.csv')).toString(), 'email\na@b.com\n');
      await storage.delete('imports/wsp_1/imp_1.csv');
      await storage.delete('imports/wsp_1/imp_1.csv');
      await assert.rejects(storage.get('imports/wsp_1/imp_1.csv'), ObjectNotFound);
    });

    it('refuses keys that could escape the store', async () => {
      const storage = await make();
      for (const key of ['../etc/passwd', 'a/../../b', '/abs', 'a//b', 'a b']) await assert.rejects(storage.put(key, Buffer.from('x'), 'text/plain'), /Unsafe/, key);
    });
  });
}

/** Just enough of S3's REST API (path-style PUT, GET, DELETE) to drive the real SDK against. */
describe('S3Storage, through @aws-sdk/client-s3 against an S3 stand-in', () => {
  const objects = new Map<string, { body: Buffer; type: string | undefined }>();
  const requests: { method: string; url: string; authorization: string | undefined }[] = [];
  let server: Server;
  let storage: S3Storage;

  beforeAll(async () => {
    server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        const path = decodeURIComponent(new URL(request.url!, 'http://s3').pathname);
        requests.push({ method: request.method!, url: path, authorization: request.headers.authorization });
        if (request.method === 'PUT') {
          objects.set(path, { body: Buffer.concat(chunks), type: request.headers['content-type'] });
          response.writeHead(200, { etag: '"x"' }).end();
        } else if (request.method === 'GET') {
          const object = objects.get(path);
          if (!object) {
            response.writeHead(404, { 'content-type': 'application/xml' }).end('<?xml version="1.0"?><Error><Code>NoSuchKey</Code><Message>The specified key does not exist.</Message></Error>');
          } else {
            response.writeHead(200, { 'content-type': object.type ?? 'application/octet-stream', 'content-length': object.body.length }).end(object.body);
          }
        } else if (request.method === 'DELETE') {
          objects.delete(path);
          response.writeHead(204).end();
        } else response.writeHead(405).end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    storage = new S3Storage({ bucket: 'catalyst', endpoint: `http://127.0.0.1:${port}`, credentials: { accessKeyId: 'test', secretAccessKey: 'test-secret' } });
  });
  afterAll(async () => {
    storage.client.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('stores, reads and deletes objects in the bucket, signed, with their content type', async () => {
    await storage.put('raw/wsp_1/msg_1.eml', Buffer.from('Subject: Hi\r\n\r\nHello'), 'message/rfc822');
    assert.deepEqual(objects.get('/catalyst/raw/wsp_1/msg_1.eml')?.type, 'message/rfc822');
    assert.equal((await storage.get('raw/wsp_1/msg_1.eml')).toString(), 'Subject: Hi\r\n\r\nHello');
    assert.ok(requests.every((request) => request.authorization?.startsWith('AWS4-HMAC-SHA256 Credential=test/')), 'every request is SigV4-signed');
    await storage.delete('raw/wsp_1/msg_1.eml');
    await storage.delete('raw/wsp_1/msg_1.eml');
    await assert.rejects(storage.get('raw/wsp_1/msg_1.eml'), ObjectNotFound);
    await assert.rejects(storage.put('../escape', Buffer.from('x'), 'text/plain'), /Unsafe/);
  });

  it('is chosen by S3_BUCKET; the filesystem otherwise', () => {
    const s3 = storageFromEnv({ S3_BUCKET: 'catalyst', S3_ENDPOINT: 'http://minio:9000', S3_ACCESS_KEY_ID: 'a', S3_SECRET_ACCESS_KEY: 'b' });
    assert.ok(s3 instanceof S3Storage && s3.bucket === 'catalyst');
    (s3 as S3Storage).client.destroy();
    assert.ok(storageFromEnv({ STORAGE_DIR: '/tmp/x' }) instanceof FileSystemStorage);
  });
});
