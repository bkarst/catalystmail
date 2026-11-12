import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { describe, it } from 'vitest';

import { API_TYPES_FILE, apiTypes } from '../scripts/api-types.ts';

describe('the UI’s API types (§4.2)', () => {
  it('match the contract (run `pnpm --filter @catalyst/web generate:api` after changing it)', async () => {
    assert.equal(await readFile(API_TYPES_FILE, 'utf8'), await apiTypes());
  });
});
