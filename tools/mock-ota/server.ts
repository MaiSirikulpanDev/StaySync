// A tiny stand-in for an OTA: records availability pushes and can be told to fail.
import { createServer } from 'node:http';

export interface OtaCall {
  listingId: string;
  body: { days: { date: string; available: boolean; rateCents: number }[] };
  status: number;
}

export interface MockOta {
  calls: OtaCall[];
  failNext(n: number): void;
  reset(): void;
  stop(): Promise<void>;
}

export async function startMockOta(
  port: number,
  failFirst = 0,
): Promise<MockOta> {
  const calls: OtaCall[] = [];
  let failing = failFirst;

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const json = (status: number, body: unknown) => {
      res
        .writeHead(status, { 'content-type': 'application/json' })
        .end(JSON.stringify(body));
    };
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
    reset: () => {
      calls.length = 0;
      failing = 0;
    },
    stop: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

if (require.main === module) {
  const port = Number(process.env.PORT ?? 4000);
  void startMockOta(port, Number(process.env.MOCK_OTA_FAIL ?? 0)).then(() =>
    console.log(`mock OTA listening on :${port}`),
  );
}
