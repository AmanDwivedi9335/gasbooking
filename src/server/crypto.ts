import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

function key() {
  const value = Buffer.from(process.env.CREDENTIAL_KEY ?? '', 'base64');
  if (value.length !== 32) throw new Error('CREDENTIAL_KEY must encode exactly 32 bytes');
  return value;
}

export function encrypt(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map(part => part.toString('base64url')).join('.');
}

export function decrypt(value: string) {
  const [iv, tag, ciphertext] = value.split('.').map(part => Buffer.from(part, 'base64url'));
  const cipher = createDecipheriv('aes-256-gcm', key(), iv);
  cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(ciphertext), cipher.final()]).toString('utf8');
}
