// ID prefixes (spec §6.1). IDs are `<prefix>_<UUIDv7 in base32>`; the prefix tells people and
// LLMs which entity they are holding. Generating IDs needs a library and lives in @catalyst/db.

export const ID_PREFIXES = {
  workspace: 'wsp',
  user: 'usr',
  api_key: 'key',
  company: 'co',
  contact: 'ctc',
  tag: 'tag',
  list: 'lst',
  custom_field: 'cfd',
  suppression: 'sup',
  domain: 'dom',
  mailbox: 'mbx',
  campaign: 'cmp',
  goal: 'gol',
  sequence: 'seq',
  step: 'stp',
  variant: 'var',
  thread: 'thr',
  message: 'msg',
  attachment: 'att',
  tracking_event: 'trk',
  link: 'lnk',
  escalation: 'esc',
  knowledge_item: 'kbi',
  ai_run: 'air',
  activity: 'act',
  webhook_endpoint: 'whk',
  webhook_delivery: 'whd',
  integration: 'int',
  integration_event: 'ine',
  import: 'imp',
  poll_run: 'prn',
  event: 'evt',
  notification: 'ntf',
  push_subscription: 'psb',
} as const;

export type IdKind = keyof typeof ID_PREFIXES;

const KIND_BY_PREFIX = new Map<string, IdKind>(Object.entries(ID_PREFIXES).map(([kind, prefix]) => [prefix, kind as IdKind]));

/** Which entity an ID belongs to, from its prefix; null if the prefix is unknown. */
export function idKind(id: string): IdKind | null {
  const separator = id.lastIndexOf('_');
  return separator <= 0 ? null : (KIND_BY_PREFIX.get(id.slice(0, separator)) ?? null);
}

/** The pattern every ID of a kind matches. */
export function idPattern(kind: IdKind): RegExp {
  return new RegExp(`^${ID_PREFIXES[kind]}_[0-9a-z]{26}$`);
}
