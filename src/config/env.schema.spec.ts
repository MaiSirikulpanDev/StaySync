import { parseEnv } from './env.schema';

const valid = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  RABBITMQ_URL: 'amqp://guest:guest@localhost:5672',
  API_KEY: 'k',
  OTA_WEBHOOK_SECRET: 's',
};

describe('parseEnv', () => {
  it('applies defaults for optional values', () => {
    const env = parseEnv(valid);
    expect(env.PORT).toBe(3000);
    expect(env.NODE_ENV).toBe('development');
    expect(env.OUTBOX_POLL_MS).toBe(1000);
    expect(env.OTA_BASE_URL).toBe('http://localhost:4000');
  });

  it('coerces PORT to a number', () => {
    expect(parseEnv({ ...valid, PORT: '8080' }).PORT).toBe(8080);
  });

  it('throws naming the missing variable', () => {
    const rest: Record<string, string> = { ...valid };
    delete rest.API_KEY;
    expect(() => parseEnv(rest)).toThrow(/API_KEY/);
  });

  it('rejects a malformed DATABASE_URL', () => {
    expect(() => parseEnv({ ...valid, DATABASE_URL: 'nope' })).toThrow(
      /DATABASE_URL/,
    );
  });
});
