import { sign, verifySignature } from './hmac';

describe('webhook HMAC', () => {
  const body = Buffer.from('{"type":"booking.created"}');

  it('accepts a signature made with the shared secret', () => {
    expect(verifySignature('s3cret', body, sign('s3cret', body))).toBe(true);
  });

  it('rejects a tampered body', () => {
    const sig = sign('s3cret', body);
    expect(
      verifySignature(
        's3cret',
        Buffer.from('{"type":"booking.cancelled"}'),
        sig,
      ),
    ).toBe(false);
  });

  it('rejects a signature made with another secret', () => {
    expect(verifySignature('s3cret', body, sign('other', body))).toBe(false);
  });

  it('rejects malformed signatures, including one of the wrong length', () => {
    expect(verifySignature('s3cret', body, '')).toBe(false);
    expect(verifySignature('s3cret', body, 'abc')).toBe(false);
  });
});
