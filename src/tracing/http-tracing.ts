import {
  context,
  propagation,
  SpanKind,
  SpanStatusCode,
  trace,
} from '@opentelemetry/api';
import type { NextFunction, Request, Response } from 'express';

/** One SERVER span per request, continuing the caller's `traceparent` if it sent one. */
export function httpTracing(req: Request, res: Response, next: NextFunction) {
  if (req.path === '/health') return next(); // polled constantly, not worth a trace
  const parent = propagation.extract(context.active(), req.headers);
  const span = trace
    .getTracer('staysync')
    .startSpan(req.method, { kind: SpanKind.SERVER }, parent);
  res.on('finish', () => {
    const route = (req.route as { path?: string } | undefined)?.path;
    span.updateName(`${req.method} ${route ?? req.path}`);
    span.setAttribute('http.response.status_code', res.statusCode);
    if (res.statusCode >= 500) span.setStatus({ code: SpanStatusCode.ERROR });
    span.end();
  });
  context.with(trace.setSpan(parent, span), next);
}
