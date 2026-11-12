// ID generation in the TypeID format (spec §6.1). The prefixes themselves live in @catalyst/core.

import { ID_PREFIXES, type IdKind } from '@catalyst/core';
import { typeidUnboxed } from 'typeid-js';

export { ID_PREFIXES, idKind, idPattern, type IdKind } from '@catalyst/core';

/** A new ID for an entity, e.g. `newId('contact')` → `ctc_01jd…`. IDs sort by creation time. */
export function newId(kind: IdKind): string {
  return typeidUnboxed(ID_PREFIXES[kind]);
}
