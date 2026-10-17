import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Clock } from '../../src/common/clock';
import { AppModule } from '../../src/app.module';
import { WorkerModule } from '../../src/worker.module';
import { configureApp } from '../../src/setup-app';
import { PrismaService } from '../../src/prisma/prisma.service';

export async function createTestApp(): Promise<INestApplication> {
  const mod = await Test.createTestingModule({
    imports: [AppModule, WorkerModule],
  })
    .overrideProvider(Clock)
    .useValue({ today: () => '2026-10-05' })
    .compile();
  const app = mod.createNestApplication({ rawBody: true });
  configureApp(app);
  await app.init();
  return app;
}

export const KEY = { 'x-api-key': 'test-key' };

export async function resetDb(app: INestApplication) {
  await app
    .get(PrismaService)
    .$executeRawUnsafe(
      'TRUNCATE "Property", "OutboxEvent", "ProcessedWebhook", "ProcessedEvent", "PropertyOccupancyDaily" CASCADE',
    );
}
