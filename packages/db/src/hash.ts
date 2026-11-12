// The suppression hash (spec §6.4, §6.11). It is kept after a contact is erased so the block
// survives, which means it has to be computable from the address alone: SHA-256 of the trimmed,
// lower-cased address.

import { createHash } from 'node:crypto';

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

export function emailHash(email: string): Buffer {
  return createHash('sha256').update(normalizeEmail(email), 'utf8').digest();
}

/** The domain part of an address, lower-cased. */
export const emailDomain = (email: string) => normalizeEmail(email).slice(email.trim().lastIndexOf('@') + 1);
