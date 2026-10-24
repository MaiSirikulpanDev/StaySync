import { INestApplication } from '@nestjs/common';
import { SpanKind } from '@opentelemetry/api';
import {
  InMemorySpanExporter,
  ReadableSpan,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import request from 'supertest';
import { MockOta, startMockOta } from '../tools/mock-ota/server';
import { createTestApp, KEY, resetDb } from './setup/app';
import { waitFor } from './setup/wait';
import { PrismaService } from '../src/prisma/prisma.service';

const TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736';

describe('tracing across the async hop', () => {
  const exporter = new InMemorySpanExporter();
  const provider = new NodeTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  let app: INestApplication;
  let ota: MockOta;

  beforeAll(async () => {
    provider.register(); // global tracer provider, W3C propagator, async context
    ota = await startMockOta(4010);
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
    await ota.stop();
    await provider.shutdown();
  });

  const parentOf = (s: ReadableSpan) => s.parentSpanContext?.spanId;
  const inTrace = () =>
    exporter
      .getFinishedSpans()
      .filter((s) => s.spanContext().traceId === TRACE_ID);

  it('keeps one trace from the HTTP request through outbox, Kafka, consumer and OTA push', async () => {
    ota.reset();
    await resetDb(app);
    const http = () => request(app.getHttpServer());
    const { body: property } = await http().post('/properties').set(KEY).send({
      name: 'Beach House',
      timezone: 'UTC',
      currency: 'AUD',
      baseRateCents: 10000,
      maxGuests: 4,
    });
    await app.get(PrismaService).channel.create({
      data: {
        propertyId: property.id,
        type: 'MOCK_OTA',
        config: { listingId: 'L1' },
      },
    });

    await http()
      .post(`/properties/${property.id}/stays`)
      .set(KEY)
      .set('traceparent', `00-${TRACE_ID}-00f067aa0ba902b7-01`)
      .send({
        kind: 'BOOKING',
        checkIn: '2026-10-08',
        checkOut: '2026-10-10',
        guestName: 'Ann',
        guests: 2,
      })
      .expect(201);

    await waitFor(
      () =>
        ['ota-sync process', 'occupancy-projection process', 'ota push'].every(
          (n) => inTrace().some((s) => s.name === n),
        ) && inTrace(),
      15000,
    );
    const spans = inTrace();
    const by = (name: string) => spans.find((s) => s.name === name)!;
    const server = spans.find((s) => s.kind === SpanKind.SERVER)!;
    const publish = by('outbox publish');
    const consume = by('ota-sync process');
    const push = by('ota push');

    expect(parentOf(server)).toBe('00f067aa0ba902b7'); // continues the caller's trace
    expect(parentOf(publish)).toBe(server.spanContext().spanId);
    expect(publish.kind).toBe(SpanKind.PRODUCER);
    expect(parentOf(consume)).toBe(publish.spanContext().spanId);
    expect(consume.kind).toBe(SpanKind.CONSUMER);
    expect(parentOf(by('occupancy-projection process'))).toBe(
      publish.spanContext().spanId,
    );
    expect(parentOf(push)).toBe(consume.spanContext().spanId);
    expect(push.kind).toBe(SpanKind.CLIENT);
  });

  it('records each MCP tool call as a child of the /mcp request span', async () => {
    const traceId = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
    await request(app.getHttpServer())
      .post('/mcp')
      .set(KEY)
      .set('accept', 'application/json, text/event-stream')
      .set('traceparent', `00-${traceId}-00f067aa0ba902b7-01`)
      .send({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'list_properties', arguments: {} },
      })
      .expect(200);

    const traced = () =>
      exporter
        .getFinishedSpans()
        .filter((s) => s.spanContext().traceId === traceId);
    await waitFor(() => traced().some((s) => s.kind === SpanKind.SERVER));
    const spans = traced();
    const server = spans.find((s) => s.kind === SpanKind.SERVER)!;
    const tool = spans.find((s) => s.name === 'mcp.tool list_properties')!;
    expect(parentOf(tool)).toBe(server.spanContext().spanId);
  });
});
