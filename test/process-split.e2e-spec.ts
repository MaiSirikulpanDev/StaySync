import { Test } from '@nestjs/testing';
import { IcalPoller } from '../src/channels/ical/ical.poller';
import { OtaConsumer } from '../src/channels/mock-ota/ota.consumer';
import { AppModule } from '../src/app.module';
import { OccupancyProjection } from '../src/occupancy/occupancy.projection';
import { OutboxPublisher } from '../src/outbox/outbox.publisher';
import { WorkerRootModule } from '../src/worker.module';
import { StaysController } from '../src/stays/stays.controller';

// compile() builds the provider graph without connecting to anything.
const background = [
  OutboxPublisher,
  OtaConsumer,
  OccupancyProjection,
  IcalPoller,
];

describe('api / worker split', () => {
  it('the api process owns no background work', async () => {
    const mod = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    for (const type of background)
      expect(() => mod.get(type, { strict: false })).toThrow();
    expect(mod.get(StaysController, { strict: false })).toBeDefined();
  });

  it('the worker process owns the publisher, both consumer groups and the iCal poller', async () => {
    const mod = await Test.createTestingModule({
      imports: [WorkerRootModule],
    }).compile();
    for (const type of background)
      expect(mod.get(type, { strict: false })).toBeDefined();
  });
});
