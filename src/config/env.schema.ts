import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z
    .string()
    .regex(/^postgres(ql)?:\/\//, 'must be a postgres URL'),
  RABBITMQ_URL: z.string().regex(/^amqps?:\/\//, 'must be an amqp URL'),
  API_KEY: z.string().min(1),
  OTA_BASE_URL: z.string().url().default('http://localhost:4000'),
  OTA_WEBHOOK_SECRET: z.string().min(1),
  ICAL_POLL_CRON: z.string().default('*/15 * * * *'),
  OUTBOX_POLL_MS: z.coerce.number().int().positive().default(1000),
});

export type Env = z.infer<typeof schema>;

export function parseEnv(raw: Record<string, unknown>): Env {
  const r = schema.safeParse(raw);
  if (!r.success) {
    const msg = r.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new Error(`Invalid environment: ${msg}`);
  }
  return r.data;
}
