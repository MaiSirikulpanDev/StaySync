import { Test } from '@nestjs/testing';
import { readdirSync, readFileSync } from 'node:fs';
import { AgentRootModule } from '../src/agent.root';
import { AgentConsumer } from '../src/agent/agent.consumer';
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

  it('the agent consumer runs only in the agent process', async () => {
    for (const imports of [[AppModule], [WorkerRootModule]]) {
      const mod = await Test.createTestingModule({ imports }).compile();
      expect(() => mod.get(AgentConsumer, { strict: false })).toThrow();
    }
    const mod = await Test.createTestingModule({
      imports: [AgentRootModule],
    }).compile();
    expect(mod.get(AgentConsumer, { strict: false })).toBeDefined();
  });

  it('only run-agent.ts touches the agent SDK, so api and worker need no key', () => {
    const files = (readdirSync('src', { recursive: true }) as string[]).filter(
      (f) => f.endsWith('.ts') && !f.endsWith('spec.ts'),
    );
    const users = files.filter((f) =>
      readFileSync(`src/${f}`, 'utf8').includes('claude-agent-sdk'),
    );
    expect(users.map((f) => f.replace(/\\/g, '/'))).toEqual([
      'agent/run-agent.ts',
    ]);
  });
});
