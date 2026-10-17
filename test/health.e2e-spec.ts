import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { EVENTS_TOPIC } from '../src/messaging/messaging.service';
import { createTestApp } from './setup/app';
import { dlqCount, produceRaw } from './setup/kafka';
import { waitFor } from './setup/wait';

describe('app smoke', () => {
  let app: INestApplication;
  beforeAll(async () => (app = await createTestApp()));
  afterAll(() => app.close());
  type Health = {
    status: string;
    info: {
      dlq: { depth: number };
      consumerLag: Record<string, number>;
    };
  };
  const health = async () =>
    (await request(app.getHttpServer()).get('/health').expect(200))
      .body as Health;

  it('serves /health ok without an API key, checking db and kafka', async () => {
    const body = await health();
    expect(body.status).toBe('ok');
    expect(Object.keys(body.info)).toEqual([
      'database',
      'kafka',
      'consumerLag',
      'dlq',
    ]);
  });

  it('serves swagger docs without an API key', async () => {
    await request(app.getHttpServer()).get('/docs').expect(200);
  });

  it('reports lag per consumer group and the DLQ depth', async () => {
    const { info } = await health();
    expect(info.consumerLag).toMatchObject({
      status: 'up',
      'ota-sync': expect.any(Number),
      'occupancy-projection': expect.any(Number),
    });
    expect(info.dlq).toMatchObject({ status: 'up', depth: expect.any(Number) });
  });

  it('shows a parked poison message in the DLQ depth, and lag back at zero once it is consumed', async () => {
    const before = await dlqCount();
    await produceRaw(EVENTS_TOPIC, 'k', 'not json at all');
    // one copy per consumer group (ota-sync, occupancy-projection)
    await waitFor(async () => (await health()).info.dlq.depth === before + 2);
    await waitFor(async () => {
      const { consumerLag } = (await health()).info;
      return consumerLag['ota-sync'] === 0 &&
        consumerLag['occupancy-projection'] === 0
        ? consumerLag
        : null;
    }, 15000);
  });
});
