// Types for the UI's API client (spec §4.2: `openapi-typescript` + `openapi-fetch`), generated
// from the same OpenAPI document the API serves. Run after changing the contract:
//   pnpm --filter @catalyst/web generate:api
// `api-types.test.ts` fails when the checked-in file is out of date.

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { buildOpenApiDocument } from '@catalyst/contract';
import openapiTS, { astToString } from 'openapi-typescript';

export const API_TYPES_FILE = fileURLToPath(new URL('../src/lib/api-types.ts', import.meta.url));

export async function apiTypes(): Promise<string> {
  const ast = await openapiTS(buildOpenApiDocument() as never);
  return `// Generated from the OpenAPI document by scripts/api-types.ts. Do not edit.\n/* eslint-disable */\n${astToString(ast)}`;
}

if (import.meta.main) {
  await writeFile(API_TYPES_FILE, await apiTypes());
  console.log(`Wrote ${API_TYPES_FILE}`);
}
