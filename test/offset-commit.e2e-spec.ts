import { KafkaJS } from '@confluentinc/kafka-javascript';
import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { CoreModule } from '../src/core.module';
import {
  EVENTS_TOPIC,
  MessagingService,
} from '../src/messaging/messaging.service';
import { waitFor } from './setup/wait';

describe('consumer offset commit', () => {
  let mod: TestingModule;
  let messaging: MessagingService;
  const admin = new KafkaJS.Kafka({
    kafkaJS: { brokers: process.env.KAFKA_BROKERS!.split(',') },
  }).admin();

  beforeAll(async () => {
    mod = await Test.createTestingModule({ imports: [CoreModule] }).compile();
    await mod.init();
    messaging = mod.get(MessagingService);
    await admin.connect();
  });
  afterAll(async () => {
    await admin.disconnect();
    await mod.close();
  });

  const committed = async (groupId: string) => {
    const [t] = await admin.fetchOffsets({ groupId, topics: [EVENTS_TOPIC] });
    return (t?.partitions ?? []).filter((p) => Number(p.offset) > 0).length;
  };

  it('commits an offset only after the handler finished, and does so right away', async () => {
    const propertyId = randomUUID();
    await messaging.publish({
      id: randomUUID(),
      type: 'stay.created',
      createdAt: new Date(),
      payload: {
        stayId: randomUUID(),
        propertyId,
        source: 'DIRECT',
        kind: 'BOOKING',
        checkIn: '2026-10-05',
        checkOut: '2026-10-06',
      },
    });

    const group = `commit-test-${randomUUID()}`;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let started = false;
    await messaging.consume(group, async () => {
      started = true;
      await gate; // the side effect is still running
    });
    await waitFor(() => started);

    await new Promise((r) => setTimeout(r, 1500));
    expect(await committed(group)).toBe(0); // in flight: nothing committed yet

    release();
    // Well inside the 5s auto-commit interval: the commit is explicit, not on a timer.
    await waitFor(async () => (await committed(group)) > 0, 2500);
  });

  it('reports how far a group is behind while its handler is busy, and zero once it caught up', async () => {
    const group = `lag-test-${randomUUID()}`;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let started = false;
    await messaging.consume(group, async () => {
      started = true;
      await gate;
    });
    await waitFor(() => started);
    expect(await messaging.lag(group)).toBeGreaterThan(0);
    release();
    await waitFor(async () => (await messaging.lag(group)) === 0, 30000);
  });
});
