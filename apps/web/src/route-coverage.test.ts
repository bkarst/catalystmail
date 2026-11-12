import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { operations } from '@catalyst/contract';
import { describe, it } from 'vitest';

const API_ROOT = fileURLToPath(new URL('./app/api/v1', import.meta.url));
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

function routeFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    // `[...path]` is the catch-all that answers unknown paths; it is not an operation.
    if (entry.isDirectory()) return entry.name.startsWith('[...') ? [] : routeFiles(path);
    return entry.name === 'route.ts' ? [path] : [];
  });
}

/** §13.4 † routes that answer with redirects, so they are not contract operations. */
const OUTSIDE_CONTRACT = ['GET /oauth/{provider}/start', 'GET /oauth/{provider}/callback', 'GET /domains/{domainId}/postmaster/connect'];

/** Next.js route segment settings a route file may export besides its methods. */
const SEGMENT_CONFIG = ['dynamic', 'maxDuration', 'runtime'];

/** `contacts/[contactId]/route.ts` → `/contacts/{contactId}` */
const apiPath = (file: string) =>
  '/' +
  relative(API_ROOT, file)
    .split(sep)
    .slice(0, -1)
    .map((segment) => segment.replace(/^\[(\w+)\]$/, '{$1}'))
    .join('/');

describe('route coverage (§19.8)', () => {
  it('has exactly one route export per operation in the contract', async () => {
    const implemented: string[] = [];
    for (const file of routeFiles(API_ROOT)) {
      const module = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
      for (const name of Object.keys(module)) {
        assert.ok(METHODS.includes(name) || SEGMENT_CONFIG.includes(name), `${file} exports "${name}", which is not an HTTP method`);
        if (METHODS.includes(name)) implemented.push(`${name} ${apiPath(file)}`);
      }
    }
    const declared = operations.map((operation) => `${operation.method.toUpperCase()} ${operation.path}`);
    assert.deepEqual(implemented.filter((route) => !OUTSIDE_CONTRACT.includes(route)).sort(), declared.sort());
    for (const route of OUTSIDE_CONTRACT) assert.ok(implemented.includes(route), `${route} is missing`);
  });
});
