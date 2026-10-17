import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { KafkaContainer } from '@testcontainers/kafka';
import { execSync } from 'node:child_process';

// One Postgres + Kafka (KRaft) for the whole e2e run. Env vars set here reach the workers.
export default async function setup() {
  const [pg, kafka] = await Promise.all([
    new PostgreSqlContainer('postgres:16').start(),
    new KafkaContainer('confluentinc/cp-kafka:7.7.0').withKraft().start(),
  ]);
  Object.assign(globalThis, { __containers: [pg, kafka] });
  Object.assign(process.env, {
    NODE_ENV: 'test',
    DATABASE_URL: pg.getConnectionUri(),
    KAFKA_BROKERS: `${kafka.getHost()}:${kafka.getMappedPort(9093)}`,
    API_KEY: 'test-key',
    OTA_WEBHOOK_SECRET: 'test-secret',
    OTA_BASE_URL: 'http://127.0.0.1:4010',
    RETRY_DELAY_MS: '500',
    OUTBOX_POLL_MS: '200',
  });
  execSync('npx prisma migrate deploy', { stdio: 'inherit', env: process.env });
}
