import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { RabbitMQContainer } from '@testcontainers/rabbitmq';
import { execSync } from 'node:child_process';

// One Postgres + RabbitMQ for the whole e2e run. Env vars set here reach the workers.
export default async function setup() {
  const [pg, mq] = await Promise.all([
    new PostgreSqlContainer('postgres:16').start(),
    new RabbitMQContainer('rabbitmq:3.13-management').start(),
  ]);
  Object.assign(globalThis, { __containers: [pg, mq] });
  Object.assign(process.env, {
    NODE_ENV: 'test',
    DATABASE_URL: pg.getConnectionUri(),
    RABBITMQ_URL: mq.getAmqpUrl(),
    API_KEY: 'test-key',
    OTA_WEBHOOK_SECRET: 'test-secret',
    OTA_BASE_URL: 'http://127.0.0.1:4010',
    RETRY_DELAY_MS: '500',
    OUTBOX_POLL_MS: '200',
  });
  execSync('npx prisma migrate deploy', { stdio: 'inherit', env: process.env });
}
