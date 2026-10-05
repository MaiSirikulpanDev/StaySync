import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Clock } from '../../src/common/clock';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/setup-app';
import { PrismaService } from '../../src/prisma/prisma.service';

export async function createTestApp(): Promise<INestApplication> {
  const mod = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(Clock)
    .useValue({ today: () => '2026-10-05' })
    .compile();
  const app = mod.createNestApplication();
  configureApp(app);
  await app.init();
  return app;
}

export const KEY = { 'x-api-key': 'test-key' };

export async function resetDb(app: INestApplication) {
  await app
    .get(PrismaService)
    .$executeRawUnsafe('TRUNCATE "Property", "OutboxEvent" CASCADE');
}
