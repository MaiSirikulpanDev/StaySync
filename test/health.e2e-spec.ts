import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './setup/app';

describe('app smoke', () => {
  let app: INestApplication;
  beforeAll(async () => (app = await createTestApp()));
  afterAll(() => app.close());

  it('serves /health ok without an API key, checking db and rabbitmq', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.body.status).toBe('ok');
    expect(Object.keys(res.body.info)).toEqual(['database', 'rabbitmq']);
  });

  it('serves swagger docs without an API key', async () => {
    await request(app.getHttpServer()).get('/docs').expect(200);
  });
});
