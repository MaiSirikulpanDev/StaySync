import {
  Context,
  context,
  propagation,
  ROOT_CONTEXT,
  Span,
  SpanKind,
  SpanStatusCode,
  trace,
} from '@opentelemetry/api';

/** The W3C `traceparent` of whatever span is active now, or null when there is none. */
export function currentTraceparent(): string | null {
  const carrier: Record<string, string> = {};
  propagation.inject(context.active(), carrier);
  return carrier.traceparent ?? null;
}

/** Context that continues a stored `traceparent`; the active one when there is nothing stored. */
export function contextFrom(traceparent?: string | null): Context {
  return traceparent
    ? propagation.extract(ROOT_CONTEXT, { traceparent })
    : context.active();
}

/** Kafka header values come as Buffers; the propagator wants strings. */
export function traceparentOf(
  headers: Record<string, unknown> | undefined,
): string | undefined {
  return (headers?.traceparent as Buffer | string | undefined)?.toString();
}

/** Runs fn inside a new span (child of `parent`), recording failures. */
export async function inSpan<T>(
  name: string,
  kind: SpanKind,
  parent: Context,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  const span = trace.getTracer('staysync').startSpan(name, { kind }, parent);
  try {
    return await context.with(trace.setSpan(parent, span), () => fn(span));
  } catch (e) {
    span.recordException(e as Error);
    span.setStatus({ code: SpanStatusCode.ERROR });
    throw e;
  } finally {
    span.end();
  }
}
