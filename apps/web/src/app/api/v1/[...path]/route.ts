// Anything under /api/v1 that isn't a declared operation. Errors from the API are always problem
// documents, including this one.

import { randomUUID } from 'node:crypto';

import { ApiError, problemResponse } from '@catalyst/server';

function unknownOperation(): Response {
  const error = new ApiError(404, 'not_found', 'No such API operation. The operations that exist are listed in /api/v1/openapi.json.');
  return problemResponse(error, `req_${randomUUID()}`);
}

export { unknownOperation as DELETE, unknownOperation as GET, unknownOperation as PATCH, unknownOperation as POST, unknownOperation as PUT };
