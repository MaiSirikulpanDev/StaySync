import { createHmac, timingSafeEqual } from 'node:crypto';

export const sign = (secret: string, body: Buffer | string) =>
  createHmac('sha256', secret).update(body).digest('hex');

export function verifySignature(
  secret: string,
  body: Buffer,
  signature: string,
): boolean {
  const expected = Buffer.from(sign(secret, body));
  const got = Buffer.from(signature);
  return got.length === expected.length && timingSafeEqual(got, expected);
}
