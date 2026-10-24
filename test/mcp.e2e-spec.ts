import { INestApplication } from '@nestjs/common';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { createTestApp, KEY, resetDb } from './setup/app';

describe('MCP server', () => {
  let app: INestApplication;
  let url: URL;
  let client: Client;
  let id: string;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createTestApp();
    await app.listen(0);
    const { port } = (app.getHttpServer() as Server).address() as AddressInfo;
    url = new URL(`http://127.0.0.1:${port}/mcp`);
    client = new Client({ name: 'e2e', version: '1.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(url, { requestInit: { headers: KEY } }),
    );
  });
  beforeEach(async () => {
    await resetDb(app);
    const res = await http().post('/properties').set(KEY).send({
      name: 'Beach House',
      timezone: 'Australia/Brisbane',
      currency: 'AUD',
      baseRateCents: 10000,
      minStay: 2,
      maxGuests: 4,
    });
    id = res.body.id;
  });
  afterAll(async () => {
    await client.close();
    await app.close();
  });

  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = (await client.callTool({
      name,
      arguments: args,
    })) as CallToolResult;
    const text = r.content[0].type === 'text' ? r.content[0].text : '';
    return { isError: r.isError ?? false, text };
  };
  const json = async <T>(name: string, args?: Record<string, unknown>) => {
    const r = await call(name, args);
    expect(r.isError).toBe(false);
    return JSON.parse(r.text) as T;
  };

  it('rejects a request without the API key', async () => {
    await http()
      .post('/mcp')
      .set('accept', 'application/json, text/event-stream')
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
      .expect(401);
  });

  it('answers GET with 405 because it is stateless', async () => {
    await http().get('/mcp').set(KEY).expect(405);
  });

  it('lists the read-only tools', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'check_availability',
      'find_stays',
      'get_property',
      'get_quote',
      'list_properties',
    ]);
    expect(tools.every((t) => t.annotations?.readOnlyHint)).toBe(true);
  });

  it('lists properties without the iCal secret', async () => {
    const r = await call('list_properties');
    expect(JSON.parse(r.text)).toEqual([
      expect.objectContaining({ id, name: 'Beach House', maxGuests: 4 }),
    ]);
    expect(r.text).not.toContain('icalToken');
  });

  it('quotes the same numbers as the REST endpoint', async () => {
    await http()
      .post(`/properties/${id}/pricing-rules`)
      .set(KEY)
      .send({ type: 'WEEKEND', adjustPercent: 20 });
    const q = { checkIn: '2026-12-17', checkOut: '2026-12-21', guests: 2 };
    const rest = await http()
      .get(`/properties/${id}/quote`)
      .query(q)
      .set(KEY)
      .expect(200);
    expect(await json('get_quote', { propertyId: id, ...q })).toEqual(
      rest.body,
    );
  });

  it('shows booked days as unavailable', async () => {
    await http().post(`/properties/${id}/stays`).set(KEY).send({
      kind: 'BOOKING',
      checkIn: '2026-12-10',
      checkOut: '2026-12-12',
      guestName: 'Ann Lee',
      guests: 2,
    });
    const days = await json<{ available: boolean }[]>('check_availability', {
      propertyId: id,
      from: '2026-12-09',
      to: '2026-12-13',
    });
    expect(days.map((d: { available: boolean }) => d.available)).toEqual([
      true,
      false,
      false,
      true,
    ]);
  });

  it('returns stays with the first name only and no email', async () => {
    await http().post(`/properties/${id}/stays`).set(KEY).send({
      kind: 'BOOKING',
      checkIn: '2026-12-10',
      checkOut: '2026-12-12',
      guestName: 'Ann Marie Lee',
      guestEmail: 'ann@example.com',
      guests: 2,
    });
    const r = await call('find_stays', { propertyId: id });
    expect(JSON.parse(r.text)).toEqual([
      expect.objectContaining({ guestFirstName: 'Ann', guests: 2 }),
    ]);
    expect(r.text).not.toMatch(/ann@example\.com|Lee/);
  });

  it.each([
    ['an impossible date', { checkIn: '2026-02-30', checkOut: '2026-03-02' }],
    [
      'checkOut before checkIn',
      { checkIn: '2026-03-05', checkOut: '2026-03-02' },
    ],
    [
      'too many guests',
      { checkIn: '2026-03-01', checkOut: '2026-03-04', guests: 9 },
    ],
  ])('returns a tool error for %s', async (_n, args) => {
    const r = await call('get_quote', { propertyId: id, ...args });
    expect(r.isError).toBe(true);
  });

  it('reports an unknown property as a tool error, not a crash', async () => {
    const r = await call('get_property', {
      propertyId: '7b1e2f0e-0000-4000-8000-000000000000',
    });
    expect(r).toEqual({
      isError: true,
      text: expect.stringContaining('Property not found'),
    });
  });
});
