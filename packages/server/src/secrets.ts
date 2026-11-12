// Secrets at rest (spec §4.5, §16): SMTP/IMAP passwords, OAuth refresh tokens, webhook and
// integration secrets and DKIM keys, encrypted with AES-256-GCM under versioned keys. The newest key
// in ENCRYPTION_KEYS encrypts; every listed key can decrypt, so keys can be rotated.
//
// A sealed value is self-describing: version (2 bytes) ‖ IV (12) ‖ auth tag (16) ‖ ciphertext.

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const IV_BYTES = 12;
const TAG_BYTES = 16;

export interface SecretBox {
  /** The version of the key `seal` uses. */
  readonly activeVersion: number;
  seal(plaintext: string): Buffer;
  open(sealed: Buffer): string;
}

export class SecretKeyError extends Error {}

/** Parses `version:base64key,…` (each key 32 bytes). */
export function parseEncryptionKeys(value: string): Map<number, Buffer> {
  const keys = new Map<number, Buffer>();
  for (const entry of value.split(',').map((part) => part.trim()).filter(Boolean)) {
    const match = /^(\d+):(.+)$/.exec(entry);
    if (!match) throw new SecretKeyError('ENCRYPTION_KEYS must be a comma-separated list of version:base64key.');
    const key = Buffer.from(match[2]!, 'base64');
    if (key.length !== 32) throw new SecretKeyError(`Encryption key version ${match[1]} is not 32 bytes.`);
    keys.set(Number(match[1]), key);
  }
  if (keys.size === 0) throw new SecretKeyError('ENCRYPTION_KEYS holds no keys.');
  return keys;
}

export function createSecretBox(keys: Map<number, Buffer>): SecretBox {
  const activeVersion = Math.max(...keys.keys());
  const active = keys.get(activeVersion)!;
  return {
    activeVersion,
    seal(plaintext) {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv('aes-256-gcm', active, iv);
      const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      const version = Buffer.alloc(2);
      version.writeUInt16BE(activeVersion);
      return Buffer.concat([version, iv, cipher.getAuthTag(), ciphertext]);
    },
    open(sealed) {
      if (sealed.length < 2 + IV_BYTES + TAG_BYTES) throw new SecretKeyError('Not a sealed secret.');
      const version = sealed.readUInt16BE(0);
      const key = keys.get(version);
      if (!key) throw new SecretKeyError(`No encryption key with version ${version}; it may have been retired too early.`);
      const iv = sealed.subarray(2, 2 + IV_BYTES);
      const tag = sealed.subarray(2 + IV_BYTES, 2 + IV_BYTES + TAG_BYTES);
      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(sealed.subarray(2 + IV_BYTES + TAG_BYTES)), decipher.final()]).toString('utf8');
    },
  };
}

/** The key version a sealed value was made with. */
export const sealedVersion = (sealed: Buffer) => sealed.readUInt16BE(0);

export function secretBoxFromEnv(env: NodeJS.ProcessEnv = process.env): SecretBox {
  const value = env.ENCRYPTION_KEYS;
  if (!value) throw new SecretKeyError('ENCRYPTION_KEYS is not set; generate one with: node -e "console.log(\'1:\' + require(\'crypto\').randomBytes(32).toString(\'base64\'))"');
  return createSecretBox(parseEncryptionKeys(value));
}
