// A tiny stand-in for an OTA: records availability pushes and can be told to fail.
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { sign } from '../../src/channels/mock-ota/hmac';

export interface OtaCall {
  listingId: string;
  body: { days: { date: string; available: boolean; rateCents: number }[] };
  status: number;
}

export interface MockOta {
  calls: OtaCall[];
  failNext(n: number): void;
  /** Serves this iCal text at /listings/:id/calendar.ics. */
  setCalendar(listingId: string, ics: string): void;
  reset(): void;
  stop(): Promise<void>;
}

export interface MockOtaOptions {
  /** The first N availability pushes answer 500. */
  failFirst?: number;
  /** Where /_simulate/booking sends its signed webhook, and the secret it signs with. */
  appUrl?: string;
  webhookSecret?: string;
}

export async function startMockOta(
  port: number,
  opts: MockOtaOptions = {},
): Promise<MockOta> {
  const calls: OtaCall[] = [];
  let failing = opts.failFirst ?? 0;
  const calendars = new Map<string, string>();

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const json = (status: number, body: unknown) => {
      res
        .writeHead(status, { 'content-type': 'application/json' })
        .end(JSON.stringify(body));
    };
    const cal = url.pathname.match(/^\/listings\/([^/]+)\/calendar\.ics$/);
    const push = url.pathname.match(/^\/listings\/([^/]+)\/availability$/);

    if (req.method === 'PUT' && push) {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        const status = failing > 0 ? 500 : 200;
        if (failing > 0) failing--;
        calls.push({ listingId: push[1], body: JSON.parse(raw), status });
        json(status, { ok: status === 200 });
      });
    } else if (req.method === 'POST' && url.pathname === '/_simulate/booking') {
      // Body is the webhook payload; an optional ?eventId= makes redelivery easy to simulate.
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        void fetch(`${opts.appUrl}/webhooks/mock-ota`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-ota-signature': sign(opts.webhookSecret ?? '', raw),
            'x-ota-event-id': url.searchParams.get('eventId') ?? randomUUID(),
          },
          body: raw,
        }).then(async (r) =>
          json(200, { status: r.status, body: await r.json() }),
        );
      });
    } else if (cal) {
      if (req.method === 'GET' && calendars.has(cal[1])) {
        res
          .writeHead(200, { 'content-type': 'text/calendar' })
          .end(calendars.get(cal[1]));
      } else {
        json(404, { error: 'no calendar' });
      }
    } else if (req.method === 'GET' && url.pathname === '/_calls') {
      json(200, calls);
    } else {
      json(404, { error: 'not found' });
    }
  });
  await new Promise<void>((resolve) => server.listen(port, resolve));

  return {
    calls,
    failNext: (n) => (failing = n),
    setCalendar: (id, ics) => void calendars.set(id, ics),
    reset: () => {
      calls.length = 0;
      calendars.clear();
      failing = 0;
    },
    stop: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

if (require.main === module) {
  const port = Number(process.env.PORT ?? 4000);
  void startMockOta(port, {
    failFirst: Number(process.env.MOCK_OTA_FAIL ?? 0),
    appUrl: process.env.APP_URL ?? 'http://localhost:3000',
    webhookSecret: process.env.OTA_WEBHOOK_SECRET,
  }).then(() => console.log(`mock OTA listening on :${port}`));
}
